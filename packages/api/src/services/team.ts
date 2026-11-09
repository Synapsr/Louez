import {
  apiEffects,
  apiHandoffs,
  db,
  lockStoreRow,
  markStore,
  storeInvitations,
  storeMembers,
  stores,
  users,
  type Transaction,
} from "@louez/db";
import { and, count, desc, eq, gt, lt, or, sql, type SQL } from "drizzle-orm";
import { nanoid } from "nanoid";

import type { HandoffLink } from "../contracts/handoffs";
import {
  INVITATION_EMAILS_PER_DAY,
  INVITATION_VALIDITY_DAYS,
  MAX_OPEN_INVITATION_APPROVALS,
  TEAM_PAGE_MAX,
  teamErrors,
  type MemberLimit,
  type TeamInvitation,
  type TeamMember,
} from "../contracts/team";
import type { ActorStore } from "../platform/procedures";
import { enqueueEffects } from "../platform/effects";
import { isApiError, platformErrors } from "../platform/errors";
import { sha256 } from "../platform/hash";
import type { ApiEvent, ApiEventStore, ApiPorts, UrlsPort } from "../platform/ports";
import { issueHandoff, readHandoffLink, type HandoffRequester } from "./handoffs";

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

const sendsEmail = (caller: Pick<TeamCaller, "ports">) =>
  !caller.ports.team || caller.ports.team.emailConfigured();

/**
 * Refuses an invitation e-mail past the store's daily cap
 * (`INVITATION_EMAILS_PER_DAY`): the e-mails queued in the last 24 hours,
 * on the database's clock. Read under the store's lock, as every invitation
 * write of the store takes it.
 */
async function assertEmailQuota(tx: Transaction, storeId: string) {
  const [row] = await tx
    .select({ count: count() })
    .from(apiEffects)
    .where(
      and(
        eq(apiEffects.storeId, storeId),
        eq(apiEffects.type, "team.invitationEmail"),
        gt(apiEffects.createdAt, sql`NOW(3) - INTERVAL 1 DAY`),
      ),
    );
  if ((row?.count ?? 0) >= INVITATION_EMAILS_PER_DAY) throw teamErrors.emailLimit();
}

/** The invitation e-mail, queued in the write's transaction when this instance sends e-mail. */
async function queueInvitationEmail(
  tx: Transaction,
  caller: TeamCaller,
  invitationId: string,
): Promise<{ invitationEmail: "queued" | "not_configured"; effectIds: string[] }> {
  if (!sendsEmail(caller)) return { invitationEmail: "not_configured", effectIds: [] };
  await assertEmailQuota(tx, caller.storeId);
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

/** An address as it is stored and compared: trimmed, lowercase. */
export const normalizeEmail = (email: string) => email.trim().toLowerCase();

/** Pending invitations of an address in a store, expired ones included. */
const pendingOf = (storeId: string, email: string) =>
  and(
    eq(storeInvitations.storeId, storeId),
    eq(storeInvitations.email, email),
    eq(storeInvitations.status, "pending"),
  );

/**
 * Whether the address may be invited to the store now, under its lock: a
 * seat left in the plan, not a member already, and no pending invitation,
 * whether or not the address has an account. The user id of its account,
 * when it has one: approving or inviting then adds them at once.
 */
async function checkInvitable(tx: Transaction, caller: TeamCaller, email: string) {
  const memberLimit = await readMemberLimit(tx, caller.storeId, caller.ports);
  if (!memberLimit.canAddMember) throw teamErrors.limitReached(memberLimit);

  const [pending] = await tx
    .select({ id: storeInvitations.id })
    .from(storeInvitations)
    .where(pendingOf(caller.storeId, email))
    .limit(1);
  if (pending) throw teamErrors.invitationAlreadySent(email, pending.id);

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
  }
  return { existingUserId: existingUser?.id ?? null, memberLimit };
}

/** The handoff an owner approves an agent's invitation through, as the invitation locks it. */
interface Approval {
  handoffId: string;
  tokenHash: string;
  /** What the owner was shown: the address joins at once. */
  joinsAtOnce: boolean;
}

/**
 * Invites someone as a member, as the dashboard always did: someone with a
 * Louez account joins at once; anyone else gets an invitation, valid 7 days,
 * by e-mail. Refused when they are already a member, when an invitation of
 * theirs is pending, when the plan's seats are full, and past the daily cap
 * of invitation e-mails. A dashboard session calls it directly; an agent's
 * invitation runs it once an owner approves it (`approval`), which completes
 * the approval's handoff in the same transaction.
 */
export async function inviteMember(
  caller: TeamCaller,
  input: { email: string },
  options: { approval?: Approval; now?: Date } = {},
) {
  const email = normalizeEmail(input.email);
  const now = options.now ?? new Date();
  const { approval } = options;

  const result = await db.transaction(async (tx) => {
    await lockStore(tx, caller.storeId);
    if (approval) {
      // Still the link the owner opened, active and in time.
      const [handoff] = await tx
        .select({ id: apiHandoffs.id })
        .from(apiHandoffs)
        .where(
          and(
            eq(apiHandoffs.id, approval.handoffId),
            eq(apiHandoffs.storeId, caller.storeId),
            eq(apiHandoffs.tokenHash, approval.tokenHash),
            eq(apiHandoffs.activeSlot, 1),
            gt(apiHandoffs.expiresAt, now),
          ),
        )
        .for("update");
      if (!handoff) throw teamErrors.approvalInvalid("invalid");
    }

    const { existingUserId } = await checkInvitable(tx, caller, email);
    if (approval && approval.joinsAtOnce !== (existingUserId !== null)) {
      throw teamErrors.approvalChanged();
    }

    let outcome;
    if (existingUserId) {
      // Only owners are in the store's billing snapshot: no billing mark.
      const id = nanoid();
      await tx.insert(storeMembers).values({
        id,
        storeId: caller.storeId,
        userId: existingUserId,
        role: "member",
        addedBy: caller.userId,
        createdAt: now,
        updatedAt: now,
      });
      // No invitation of theirs may add them again later.
      await tx
        .update(storeInvitations)
        .set({ status: "cancelled" })
        .where(pendingOf(caller.storeId, email));
      const [member] = await tx
        .select(memberColumns)
        .from(storeMembers)
        .innerJoin(users, eq(users.id, storeMembers.userId))
        .where(eq(storeMembers.id, id));
      outcome = {
        outcome: "added" as const,
        member: member ?? null,
        invitation: null,
        invitationEmail: null,
        effectIds: [] as string[],
      };
    } else {
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
      outcome = {
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
    }

    if (approval) {
      await tx
        .update(apiHandoffs)
        .set({ status: "completed", completedAt: now, activeSlot: null, updatedAt: now })
        .where(eq(apiHandoffs.id, approval.handoffId));
    }
    return outcome;
  });

  emit(caller, { type: "team.memberInvited", store: eventStore(caller), email });
  return result;
}

/**
 * An agent's invitation: nothing is created yet. It records an approval for
 * the address (a `team_invitation` handoff: the store, the address, the
 * role and whether the address joins at once) and returns the link an owner
 * approves it from. The same address asked again gets the same approval with
 * a new link. The checks of an invitation run first, so a request that could
 * never be approved is refused at once; a store holds at most
 * `MAX_OPEN_INVITATION_APPROVALS` open approvals.
 */
export async function requestInvitationApproval(
  caller: TeamCaller,
  requester: HandoffRequester,
  input: { email: string },
  urls: UrlsPort,
): Promise<HandoffLink> {
  const email = normalizeEmail(input.email);
  return issueHandoff(requester, "team_invitation", {
    urls,
    subject: sha256(email),
    prepare: async (tx, active) => {
      const { existingUserId } = await checkInvitable(tx, caller, email);
      if (!existingUserId && sendsEmail(caller)) await assertEmailQuota(tx, caller.storeId);
      if (!active) {
        const [open] = await tx
          .select({ count: count() })
          .from(apiHandoffs)
          .where(
            and(
              eq(apiHandoffs.storeId, caller.storeId),
              eq(apiHandoffs.kind, "team_invitation"),
              eq(apiHandoffs.activeSlot, 1),
              gt(apiHandoffs.expiresAt, sql`NOW(3)`),
            ),
          );
        if ((open?.count ?? 0) >= MAX_OPEN_INVITATION_APPROVALS) throw teamErrors.approvalsFull();
      }
      return { email, role: "member", joinsAtOnce: existingUserId !== null };
    },
  });
}

/** The handoff failure an invitation's refusal ends an approval with. */
function approvalFailure(error: unknown): string | null {
  if (!isApiError(error)) return null;
  switch (error.data.code) {
    case "TEAM_ALREADY_MEMBER":
    case "TEAM_INVITATION_ALREADY_SENT":
    case "TEAM_APPROVAL_CHANGED":
      return "request_changed";
    case "TEAM_LIMIT_REACHED":
      return "limit_reached";
    case "TEAM_INVITATION_EMAIL_LIMIT":
      return "email_limit";
    default:
      return null;
  }
}

/** Ends an approval, while its link is still the current one. */
async function endApproval(handoffId: string, tokenHash: string, code: string, now: Date) {
  await db
    .update(apiHandoffs)
    .set({ status: "failed", failedAt: now, failureCode: code, activeSlot: null, updatedAt: now })
    .where(
      and(
        eq(apiHandoffs.id, handoffId),
        eq(apiHandoffs.tokenHash, tokenHash),
        eq(apiHandoffs.activeSlot, 1),
      ),
    );
}

/**
 * An owner's answer to an agent's invitation, signed in on its link's page:
 * the link's user, still allowed to manage the team (`manage_members`). To
 * approve runs the invitation as the dashboard does and completes the
 * approval; to decline ends it as failed (`declined`). An invitation that
 * can no longer go out as shown (the address joined, got an account or an
 * invitation since, the seats are full) ends the approval too, with why.
 */
export async function decideInvitation(
  input: { token: string; decision: "approve" | "decline"; userId: string },
  ports: Pick<ApiPorts, "team" | "afterCommit">,
  now = new Date(),
) {
  const checked = await readHandoffLink(input.token, input.userId, now);
  if (!checked.ok) throw teamErrors.approvalInvalid(checked.reason);
  const { row } = checked;
  if (row.kind !== "team_invitation" || !row.payload) throw teamErrors.approvalInvalid("invalid");

  if (input.decision === "decline") {
    await endApproval(row.id, row.tokenHash, "declined", now);
    return { handoffId: row.id, decision: "declined" as const, outcome: null, effectIds: [] };
  }

  const [store] = await db
    .select({
      id: stores.id,
      name: stores.name,
      slug: stores.slug,
      userId: stores.userId,
      logoUrl: stores.logoUrl,
      settings: stores.settings,
    })
    .from(stores)
    .where(eq(stores.id, row.storeId));
  if (!store) throw platformErrors.noStore();
  const caller: TeamCaller = { storeId: store.id, userId: input.userId, store, ports };
  try {
    const result = await inviteMember(
      caller,
      { email: row.payload.email },
      {
        approval: {
          handoffId: row.id,
          tokenHash: row.tokenHash,
          joinsAtOnce: row.payload.joinsAtOnce,
        },
        now,
      },
    );
    return {
      handoffId: row.id,
      decision: "approved" as const,
      outcome: result.outcome,
      effectIds: result.effectIds,
    };
  } catch (error) {
    const failure = approvalFailure(error);
    if (failure) await endApproval(row.id, row.tokenHash, failure, now);
    throw error;
  }
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
 * A member removed from the store: they lose access on their next call, and
 * their pending invitations to the store are cancelled. An owner is never
 * removed, so the store always keeps its owner, and nobody removes
 * themselves.
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
    // An earlier invitation of theirs must not let them back in.
    await tx
      .update(storeInvitations)
      .set({ status: "cancelled" })
      .where(pendingOf(caller.storeId, normalizeEmail(member.email)));
    return { id, userId: member.userId, email: member.email };
  });

  if (refusal) throw refusal;
  if (!result) throw platformErrors.noStore();
  emit(caller, { type: "team.changed", store: eventStore(caller) });
  return result;
}

/**
 * The invited person accepts, signed in with the invited address. Under the
 * store's lock, as every team write: the invitation is read again and locked,
 * still pending with this token and in time, the seats checked again for a
 * member, and it is consumed by a statement that changes it only while it
 * is still so, so a cancellation or a removal committed meanwhile wins.
 */
export async function acceptInvitation(
  input: { token: string; name?: string; userId: string },
  ports: Pick<ApiPorts, "team">,
  now = new Date(),
): Promise<{ storeId: string }> {
  // Only to find the store to lock: everything is read again under it.
  const [found] = await db
    .select({ storeId: storeInvitations.storeId })
    .from(storeInvitations)
    .where(eq(storeInvitations.token, input.token))
    .limit(1);
  if (!found) throw teamErrors.acceptInvalid();

  await db.transaction(async (tx) => {
    await lockStore(tx, found.storeId);
    const [invitation] = await tx
      .select()
      .from(storeInvitations)
      .where(
        and(
          eq(storeInvitations.token, input.token),
          eq(storeInvitations.storeId, found.storeId),
          eq(storeInvitations.status, "pending"),
        ),
      )
      .for("update");
    if (!invitation) throw teamErrors.acceptInvalid();
    if (invitation.expiresAt.getTime() <= now.getTime()) throw teamErrors.acceptExpired();

    const [user] = await tx.select().from(users).where(eq(users.id, input.userId)).limit(1);
    if (!user) throw platformErrors.unauthenticated();
    if (normalizeEmail(user.email) !== normalizeEmail(invitation.email)) {
      throw teamErrors.acceptEmailMismatch();
    }
    const [membership] = await tx
      .select({ id: storeMembers.id })
      .from(storeMembers)
      .where(and(eq(storeMembers.storeId, invitation.storeId), eq(storeMembers.userId, user.id)))
      .limit(1);
    if (membership) throw teamErrors.acceptAlreadyMember();
    if (invitation.role === "member") {
      const memberLimit = await readMemberLimit(tx, invitation.storeId, ports);
      if (!memberLimit.canAddMember) throw teamErrors.acceptLimitReached(memberLimit);
    }

    const [consumed] = await tx
      .update(storeInvitations)
      .set({ status: "accepted", acceptedAt: now })
      .where(
        and(
          eq(storeInvitations.id, invitation.id),
          eq(storeInvitations.token, input.token),
          eq(storeInvitations.status, "pending"),
          gt(storeInvitations.expiresAt, now),
        ),
      );
    if (consumed.affectedRows !== 1) throw teamErrors.acceptInvalid();

    // Their name when the account has none, and that they reached Louez
    // through an invitation, unless a channel is known already.
    const name = input.name?.trim();
    const userUpdates = {
      ...(name && !user.name ? { name } : {}),
      ...(user.acquisitionChannel ? {} : { acquisitionChannel: "invitation" }),
    };
    if (Object.keys(userUpdates).length > 0) {
      await tx.update(users).set(userUpdates).where(eq(users.id, user.id));
    }
    await tx.insert(storeMembers).values({
      storeId: invitation.storeId,
      userId: user.id,
      role: invitation.role,
      addedBy: invitation.invitedBy,
    });
    // The store's billing snapshot lists its owners.
    if (invitation.role === "owner") await markStore(tx, invitation.storeId);
  });

  return { storeId: found.storeId };
}
