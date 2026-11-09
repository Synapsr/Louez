import {
  db,
  lockStoreRow,
  storeInvitations,
  storeMembers,
  users,
  type Transaction,
} from "@louez/db";
import { and, count, desc, eq, lt, or, type SQL } from "drizzle-orm";
import { nanoid } from "nanoid";

import {
  INVITATION_VALIDITY_DAYS,
  TEAM_PAGE_MAX,
  teamErrors,
  type MemberLimit,
  type TeamInvitation,
  type TeamMember,
} from "../contracts/team";
import type { ActorStore } from "../platform/procedures";
import { enqueueEffects } from "../platform/effects";
import { platformErrors } from "../platform/errors";
import type { ApiEvent, ApiEventStore, ApiPorts } from "../platform/ports";

/**
 * The store's team: its members and pending invitations, and the writes the
 * dashboard and agents make on them. Every write takes the store row's lock
 * first, so two invitations of one address, or an invitation and the seat
 * count, are decided one after the other.
 *
 * Who may do what is the procedures' business (routers/dashboard/team.ts):
 * the writes need `manage_members`, which owners hold; an invitation is
 * always for `member`.
 */

/** Who calls, and what the team writes need from the app. */
export interface TeamCaller {
  storeId: string;
  userId: string;
  store: Pick<ActorStore, "id" | "name" | "slug" | "userId" | "logoUrl" | "settings">;
  ports: Pick<ApiPorts, "team" | "afterCommit">;
}

/** Asks for the confirmation under the write's lock: null to go on, else the refusal to throw. */
type Confirm<TPreview> = (preview: TPreview, tx: Transaction) => Promise<Error | null>;

const DAY_MS = 86_400_000;

const eventStore = (caller: TeamCaller): ApiEventStore => ({
  id: caller.store.id,
  name: caller.store.name,
  slug: caller.store.slug,
  ownerUserId: caller.store.userId,
});

/** An effect must never fail a write that has committed. */
function emit(caller: TeamCaller, event: ApiEvent) {
  try {
    caller.ports.afterCommit(event);
  } catch (error) {
    console.error("A team effect failed after its commit:", error);
  }
}

const memberColumns = {
  id: storeMembers.id,
  userId: storeMembers.userId,
  name: users.name,
  email: users.email,
  imageUrl: users.image,
  role: storeMembers.role,
  joinedAt: storeMembers.createdAt,
};

const invitationColumns = {
  id: storeInvitations.id,
  email: storeInvitations.email,
  role: storeInvitations.role,
  invitedAt: storeInvitations.createdAt,
  expiresAt: storeInvitations.expiresAt,
};

type InvitationRow = Omit<TeamInvitation, "expired">;

const toInvitation = (row: InvitationRow, now: Date): TeamInvitation => ({
  ...row,
  expired: row.expiresAt.getTime() <= now.getTime(),
});

type Executor = Transaction | typeof db;

/** The plan's seats: members with the `member` role, against the plan's limit. */
async function readMemberLimit(
  executor: Executor,
  storeId: string,
  ports: Pick<ApiPorts, "team">,
): Promise<MemberLimit> {
  const [[row], limit] = await Promise.all([
    executor
      .select({ count: count() })
      .from(storeMembers)
      .where(and(eq(storeMembers.storeId, storeId), eq(storeMembers.role, "member"))),
    ports.team ? ports.team.collaboratorLimit(storeId) : Promise.resolve(null),
  ]);
  const current = row?.count ?? 0;
  return { current, limit, canAddMember: limit === null || current < limit };
}

/** Rows after the cursor's row, newest first: date, then id, so a cursor never skips or repeats. */
const after = (
  date: typeof storeMembers.createdAt | typeof storeInvitations.createdAt,
  id: typeof storeMembers.id | typeof storeInvitations.id,
  cursor: { date: Date; id: string },
) => or(lt(date, cursor.date), and(eq(date, cursor.date), lt(id, cursor.id))) as SQL;

/**
 * One page of the store's members, newest first, as the team page lists
 * them, with the plan's seats.
 */
export async function listMembers(
  storeId: string,
  input: { cursor?: string; limit?: number },
  ports: Pick<ApiPorts, "team">,
): Promise<{ items: TeamMember[]; nextCursor: string | null; memberLimit: MemberLimit }> {
  const limit = input.limit ?? TEAM_PAGE_MAX;
  const conditions: SQL[] = [eq(storeMembers.storeId, storeId)];
  if (input.cursor) {
    const [row] = await db
      .select({ date: storeMembers.createdAt, id: storeMembers.id })
      .from(storeMembers)
      .where(and(eq(storeMembers.id, input.cursor), eq(storeMembers.storeId, storeId)))
      .limit(1);
    if (!row) throw teamErrors.invalidCursor();
    conditions.push(after(storeMembers.createdAt, storeMembers.id, row));
  }

  const [rows, memberLimit] = await Promise.all([
    db
      .select(memberColumns)
      .from(storeMembers)
      .innerJoin(users, eq(users.id, storeMembers.userId))
      .where(and(...conditions))
      .orderBy(desc(storeMembers.createdAt), desc(storeMembers.id))
      .limit(limit + 1),
    readMemberLimit(db, storeId, ports),
  ]);
  const items = rows.slice(0, limit);
  const last = items[items.length - 1];
  return { items, nextCursor: rows.length > limit && last ? last.id : null, memberLimit };
}

/** One page of the store's pending invitations, newest first, expired ones included. */
export async function listInvitations(
  storeId: string,
  input: { cursor?: string; limit?: number },
  now = new Date(),
): Promise<{ items: TeamInvitation[]; nextCursor: string | null }> {
  const limit = input.limit ?? TEAM_PAGE_MAX;
  const pending = and(
    eq(storeInvitations.storeId, storeId),
    eq(storeInvitations.status, "pending"),
  ) as SQL;
  const conditions: SQL[] = [pending];
  if (input.cursor) {
    const [row] = await db
      .select({ date: storeInvitations.createdAt, id: storeInvitations.id })
      .from(storeInvitations)
      .where(and(pending, eq(storeInvitations.id, input.cursor)))
      .limit(1);
    if (!row) throw teamErrors.invalidCursor();
    conditions.push(after(storeInvitations.createdAt, storeInvitations.id, row));
  }

  const rows = await db
    .select(invitationColumns)
    .from(storeInvitations)
    .where(and(...conditions))
    .orderBy(desc(storeInvitations.createdAt), desc(storeInvitations.id))
    .limit(limit + 1);
  const items = rows.slice(0, limit).map((row) => toInvitation(row, now));
  const last = items[items.length - 1];
  return { items, nextCursor: rows.length > limit && last ? last.id : null };
}

async function lockStore(tx: Transaction, storeId: string) {
  if (!(await lockStoreRow(tx, storeId))) throw platformErrors.noStore();
}

/** The name the invitation e-mail gives for who invited: the caller's. */
async function inviterName(tx: Transaction, userId: string) {
  const [inviter] = await tx
    .select({ name: users.name, email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return inviter?.name || inviter?.email || "Un membre";
}

/** The invitation e-mail, queued in the write's transaction when this instance sends e-mail. */
async function queueInvitationEmail(
  tx: Transaction,
  caller: TeamCaller,
  invitationId: string,
): Promise<{ invitationEmail: "queued" | "not_configured"; effectIds: string[] }> {
  if (caller.ports.team && !caller.ports.team.emailConfigured()) {
    return { invitationEmail: "not_configured", effectIds: [] };
  }
  const effectIds = await enqueueEffects(tx, caller.storeId, [
    {
      type: "team.invitationEmail",
      payload: {
        invitationId,
        store: {
          name: caller.store.name,
          logoUrl: caller.store.logoUrl,
          country: caller.store.settings?.country ?? null,
        },
        inviterName: await inviterName(tx, caller.userId),
      },
      orderingKey: `invitation:${invitationId}:email`,
    },
  ]);
  return { invitationEmail: "queued", effectIds };
}

const invitationExpiry = (now: Date) => new Date(now.getTime() + INVITATION_VALIDITY_DAYS * DAY_MS);

const seeTheStore =
  "they will see the store's data (customers, reservations, payments) and can change products and reservations";

/** What an invitation will do, shown before it runs. */
export interface InvitePreview {
  summary: string;
  email: string;
  role: "member";
  /** The person already has a Louez account: they join at once, with no e-mail. */
  joinsAtOnce: boolean;
  memberLimit: MemberLimit;
}

/**
 * Invites someone as a member, as the dashboard always did: someone with a
 * Louez account joins at once; anyone else gets an invitation, valid 7 days,
 * by e-mail. Refused when they are already a member, when their invitation
 * is pending, and when the plan's seats are full.
 */
export async function inviteMember(
  caller: TeamCaller,
  input: { email: string },
  options: { confirm?: Confirm<InvitePreview>; now?: Date } = {},
) {
  const email = input.email.trim().toLowerCase();
  const now = options.now ?? new Date();
  let refusal: Error | null = null;

  const result = await db.transaction(async (tx) => {
    await lockStore(tx, caller.storeId);

    const memberLimit = await readMemberLimit(tx, caller.storeId, caller.ports);
    if (!memberLimit.canAddMember) throw teamErrors.limitReached(memberLimit);

    const [existingUser] = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    if (existingUser) {
      const [membership] = await tx
        .select({ id: storeMembers.id })
        .from(storeMembers)
        .where(
          and(eq(storeMembers.storeId, caller.storeId), eq(storeMembers.userId, existingUser.id)),
        )
        .limit(1);
      if (membership) throw teamErrors.alreadyMember(email);
    } else {
      const [pending] = await tx
        .select({ id: storeInvitations.id })
        .from(storeInvitations)
        .where(
          and(
            eq(storeInvitations.storeId, caller.storeId),
            eq(storeInvitations.email, email),
            eq(storeInvitations.status, "pending"),
          ),
        )
        .limit(1);
      if (pending) throw teamErrors.invitationAlreadySent(email, pending.id);
    }

    const store = caller.store.name;
    const preview: InvitePreview = {
      summary: existingUser
        ? `${email} already has a Louez account: they join "${store}" at once as a member, and ${seeTheStore}.`
        : `Invite ${email} to "${store}" as a member. They get an e-mail with a link valid ${INVITATION_VALIDITY_DAYS} days; once they accept, ${seeTheStore}.`,
      email,
      role: "member",
      joinsAtOnce: Boolean(existingUser),
      memberLimit,
    };
    refusal = (await options.confirm?.(preview, tx)) ?? null;
    if (refusal) return null;

    if (existingUser) {
      // Only owners are in the store's billing snapshot: no billing mark.
      const id = nanoid();
      await tx.insert(storeMembers).values({
        id,
        storeId: caller.storeId,
        userId: existingUser.id,
        role: "member",
        addedBy: caller.userId,
        createdAt: now,
        updatedAt: now,
      });
      const [member] = await tx
        .select(memberColumns)
        .from(storeMembers)
        .innerJoin(users, eq(users.id, storeMembers.userId))
        .where(eq(storeMembers.id, id));
      return {
        outcome: "added" as const,
        member: member ?? null,
        invitation: null,
        invitationEmail: null,
        effectIds: [] as string[],
      };
    }

    const id = nanoid();
    const invitation = {
      id,
      storeId: caller.storeId,
      email,
      role: "member" as const,
      token: nanoid(32),
      invitedBy: caller.userId,
      expiresAt: invitationExpiry(now),
      createdAt: now,
    };
    await tx.insert(storeInvitations).values(invitation);
    const queued = await queueInvitationEmail(tx, caller, id);
    return {
      outcome: "invited" as const,
      member: null,
      invitation: toInvitation(
        {
          id,
          email,
          role: "member",
          invitedAt: invitation.createdAt,
          expiresAt: invitation.expiresAt,
        },
        now,
      ),
      ...queued,
    };
  });

  if (refusal) throw refusal;
  if (!result) throw platformErrors.noStore();
  emit(caller, { type: "team.memberInvited", store: eventStore(caller), email });
  return result;
}

async function lockPendingInvitation(tx: Transaction, storeId: string, id: string) {
  const [row] = await tx
    .select({ ...invitationColumns, token: storeInvitations.token })
    .from(storeInvitations)
    .where(
      and(
        eq(storeInvitations.id, id),
        eq(storeInvitations.storeId, storeId),
        eq(storeInvitations.status, "pending"),
      ),
    )
    .limit(1)
    .for("update");
  if (!row) throw teamErrors.invitationNotFound(id);
  return row;
}

/** A pending invitation sent again: a new link (the old one stops working), valid 7 days. */
export async function resendInvitation(caller: TeamCaller, id: string, now = new Date()) {
  const result = await db.transaction(async (tx) => {
    await lockStore(tx, caller.storeId);
    const row = await lockPendingInvitation(tx, caller.storeId, id);
    const expiresAt = invitationExpiry(now);
    await tx
      .update(storeInvitations)
      .set({ token: nanoid(32), expiresAt })
      .where(eq(storeInvitations.id, id));
    const queued = await queueInvitationEmail(tx, caller, id);
    return {
      invitation: toInvitation(
        {
          id,
          email: row.email,
          role: row.role,
          invitedAt: row.invitedAt,
          expiresAt,
        },
        now,
      ),
      ...queued,
    };
  });
  emit(caller, { type: "team.changed", store: eventStore(caller) });
  return result;
}

/** The token of a pending invitation, for the dashboard's copied link. */
export async function invitationToken(storeId: string, id: string): Promise<string> {
  const [row] = await db
    .select({ token: storeInvitations.token })
    .from(storeInvitations)
    .where(
      and(
        eq(storeInvitations.id, id),
        eq(storeInvitations.storeId, storeId),
        eq(storeInvitations.status, "pending"),
      ),
    )
    .limit(1);
  if (!row) throw teamErrors.invitationNotFound(id);
  return row.token;
}

/** What cancelling an invitation will do, shown before it runs. */
export interface CancelInvitationPreview {
  summary: string;
  invitation: TeamInvitation;
}

/** A pending invitation cancelled: its link stops working. */
export async function cancelInvitation(
  caller: TeamCaller,
  id: string,
  options: { confirm?: Confirm<CancelInvitationPreview>; now?: Date } = {},
) {
  const now = options.now ?? new Date();
  let refusal: Error | null = null;

  const result = await db.transaction(async (tx) => {
    await lockStore(tx, caller.storeId);
    const { token: _token, ...row } = await lockPendingInvitation(tx, caller.storeId, id);
    const invitation = toInvitation(row, now);
    refusal =
      (await options.confirm?.(
        {
          summary: `Cancel the invitation of ${invitation.email} to "${caller.store.name}". Its link stops working, and they do not join the store.`,
          invitation,
        },
        tx,
      )) ?? null;
    if (refusal) return null;

    await tx
      .update(storeInvitations)
      .set({ status: "cancelled" })
      .where(eq(storeInvitations.id, id));
    return { id, email: invitation.email };
  });

  if (refusal) throw refusal;
  if (!result) throw platformErrors.noStore();
  emit(caller, { type: "team.changed", store: eventStore(caller) });
  return result;
}

/** What removing a member will do, shown before it runs. */
export interface RemoveMemberPreview {
  summary: string;
  member: TeamMember;
}

/**
 * A member removed from the store: they lose access on their next call. An
 * owner is never removed, so the store always keeps its owner, and nobody
 * removes themselves.
 */
export async function removeMember(
  caller: TeamCaller,
  id: string,
  options: { confirm?: Confirm<RemoveMemberPreview> } = {},
) {
  let refusal: Error | null = null;

  const result = await db.transaction(async (tx) => {
    await lockStore(tx, caller.storeId);
    const [member] = await tx
      .select(memberColumns)
      .from(storeMembers)
      .innerJoin(users, eq(users.id, storeMembers.userId))
      .where(and(eq(storeMembers.id, id), eq(storeMembers.storeId, caller.storeId)))
      .limit(1)
      .for("update");
    if (!member) throw teamErrors.memberNotFound(id);
    if (member.userId === caller.userId) throw teamErrors.cannotRemoveSelf(id);
    if (member.role === "owner") throw teamErrors.ownerNotRemovable(id);

    const who = member.name ? `${member.name} (${member.email})` : member.email;
    refusal =
      (await options.confirm?.(
        {
          summary: `Remove ${who} from "${caller.store.name}". They lose access to the store at once: its customers, reservations and payments.`,
          member,
        },
        tx,
      )) ?? null;
    if (refusal) return null;

    // Never an owner, so the store's billing snapshot does not change.
    await tx.delete(storeMembers).where(eq(storeMembers.id, id));
    return { id, userId: member.userId, email: member.email };
  });

  if (refusal) throw refusal;
  if (!result) throw platformErrors.noStore();
  emit(caller, { type: "team.changed", store: eventStore(caller) });
  return result;
}
