import { z } from "zod";

import { apiError } from "../platform/errors";
import { handoffLinkSchema } from "./handoffs";
import { resourceLinksSchema } from "./links";

/**
 * The team contract: who works in the store, the invitations still pending,
 * and the writes on them. No database here.
 *
 * Roles are `owner` and `member`. An invitation, from the dashboard or an
 * agent, is always for `member`: nothing here makes an owner, and there is no
 * way to change a role (plan, section 2). An agent's invitation is approved
 * by an owner from a link (a `team_invitation` handoff) before anything is
 * created.
 */

/** Largest page the team lists return, and their default. */
export const TEAM_PAGE_MAX = 100;

/** How long an invitation stays valid, as the dashboard always gave it. */
export const INVITATION_VALIDITY_DAYS = 7;

/**
 * Most invitation approvals an agent may leave open in a store at once.
 * Each one waits for an owner's click: a store hiring a seasonal crew asks
 * for a handful, and ten keeps a runaway agent from burying the owner in
 * links it would then have to sort.
 */
export const MAX_OPEN_INVITATION_APPROVALS = 10;

/**
 * Most invitation e-mails a store sends in 24 hours, from the dashboard and
 * agents together, sends again included. Plans allow a few members, so a
 * real store sends far fewer; twenty bounds what one store can make Louez's
 * sender mail to strangers, whose complaints would hurt every store's mail.
 */
export const INVITATION_EMAILS_PER_DAY = 20;

const idSchema = z.string().min(1).max(64);

export const teamRoleSchema = z.enum(["owner", "member"]);

/** A member of the store, as the team page shows them. */
export const teamMemberSchema = z.object({
  /** The membership's id, which team_remove_member takes. */
  id: z.string(),
  userId: z.string(),
  name: z.string().nullable(),
  email: z.string(),
  imageUrl: z.string().nullable(),
  role: teamRoleSchema,
  /** When they joined the store. */
  joinedAt: z.date(),
});
export type TeamMember = z.infer<typeof teamMemberSchema>;

/** A pending invitation, as the team page shows it: never its token or link. */
export const teamInvitationSchema = z.object({
  id: z.string(),
  email: z.string(),
  role: teamRoleSchema,
  invitedAt: z.date(),
  expiresAt: z.date(),
  /** Past its expiry: the link no longer works until it is sent again. */
  expired: z.boolean(),
});
export type TeamInvitation = z.infer<typeof teamInvitationSchema>;

/** The store's team-member allowance: members other than owners. */
export const memberLimitSchema = z.object({
  /** Members with the `member` role. */
  current: z.number().int(),
  /** Null: unlimited. 0: the store may have no members at all. */
  limit: z.number().int().nullable(),
  /** Whether one more member fits in the allowance. */
  canAddMember: z.boolean(),
});
export type MemberLimit = z.infer<typeof memberLimitSchema>;

const pageInput = (listTool: string) =>
  z.object({
    cursor: z
      .string()
      .max(64)
      .optional()
      .describe(`The nextCursor of the previous ${listTool} page. Leave it out for the first page.`),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(TEAM_PAGE_MAX)
      .optional()
      .describe(`Rows per page, ${TEAM_PAGE_MAX} at most and by default.`),
  });

const teamPageLinks = resourceLinksSchema.describe(
  "The dashboard's team page, where the user invites and sends invitations again.",
);

export const listMembersInput = pageInput("team_list_members");
export const listMembersOutput = z.object({
  items: z.array(teamMemberSchema),
  /** Null on the last page. */
  nextCursor: z.string().nullable(),
  memberLimit: memberLimitSchema,
  links: teamPageLinks,
});

export const listInvitationsInput = pageInput("team_list_invitations");
export const listInvitationsOutput = z.object({
  items: z.array(teamInvitationSchema),
  /** Null on the last page. */
  nextCursor: z.string().nullable(),
  links: teamPageLinks,
});

export const inviteMemberInput = z.object({
  email: z
    .email()
    .max(255)
    .describe("The e-mail address of the person to invite."),
  role: z
    .literal("member")
    .optional()
    .describe(
      'Always "member", the only role an invitation gives. Owners are never invited.',
    ),
});
export const inviteMemberOutput = z.object({
  /**
   * `invited`: an invitation went out, valid 7 days. `added`: the person
   * already had a Louez account and joined the store at once.
   * `approval_requested` (an agent): nothing was created yet; an owner
   * approves or declines from `approval.url`.
   */
  outcome: z.enum(["invited", "added", "approval_requested"]),
  invitation: teamInvitationSchema.nullable(),
  member: teamMemberSchema.nullable(),
  /**
   * The invitation e-mail: `queued` to be sent, `not_configured` when this
   * instance sends no e-mail (the user shares the link from the dashboard).
   * Null when the person was added, or for an approval request.
   */
  invitationEmail: z.enum(["queued", "not_configured"]).nullable(),
  /**
   * An agent's request: the link to give the user, and the handoff to read
   * with handoffs_get (completed once approved, failed once declined).
   */
  approval: handoffLinkSchema.nullable(),
  links: teamPageLinks,
});

/** An owner's answer to an agent's invitation, from its page. */
export const decideInvitationInput = z.object({
  /** The page's link: the handoff's id, or an older link's id then its secret. */
  token: z.string().min(1).max(128),
  decision: z.enum(["approve", "decline"]),
  /** The revision the page showed: another one decides nothing. */
  revision: z.number().int().positive(),
});
export const decideInvitationOutput = z.object({
  /** The handoff the agent reads. */
  handoffId: z.string(),
  decision: z.enum(["approved", "declined"]),
  outcome: z.enum(["invited", "added"]).nullable(),
});

/** The invited person accepts, signed in with the invited address. */
export const acceptInvitationInput = z.object({
  token: z.string().min(1).max(64),
  /** Their name, kept when their account has none yet. */
  name: z.string().trim().max(255).optional(),
});
export const acceptInvitationOutput = z.object({ storeId: z.string() });

export const resendInvitationInput = z.object({ id: idSchema });
export const resendInvitationOutput = z.object({
  invitation: teamInvitationSchema,
  invitationEmail: z.enum(["queued", "not_configured"]),
});

export const invitationLinkInput = z.object({ id: idSchema });
export const invitationLinkOutput = z.object({ url: z.string() });

export const cancelInvitationInput = z.object({
  id: idSchema.describe("The invitation's id, from team_list_invitations."),
});
export const cancelInvitationOutput = z.object({
  id: z.string(),
  email: z.string(),
  cancelled: z.literal(true),
  links: teamPageLinks,
});

export const removeMemberInput = z.object({
  id: idSchema.describe("The membership's id, from team_list_members (not the user id)."),
});
export const removeMemberOutput = z.object({
  id: z.string(),
  userId: z.string(),
  email: z.string(),
  removed: z.literal(true),
  links: teamPageLinks,
});

export const teamErrors = {
  memberNotFound: (id: string) =>
    apiError("NOT_FOUND", "TEAM_MEMBER_NOT_FOUND", {
      message: `This store has no member ${id}. team_list_members gives the membership ids.`,
      i18nKey: "errors.notFound",
      details: { id },
    }),
  invitationNotFound: (id: string) =>
    apiError("NOT_FOUND", "TEAM_INVITATION_NOT_FOUND", {
      message: `This store has no pending invitation ${id}. team_list_invitations gives the pending ones.`,
      i18nKey: "errors.notFound",
      details: { id },
    }),
  alreadyMember: (email: string) =>
    apiError("CONFLICT", "TEAM_ALREADY_MEMBER", {
      message: `${email} is already a member of this store.`,
      i18nKey: "dashboard.team.alreadyMember",
      details: { email },
    }),
  invitationAlreadySent: (email: string, invitationId: string) =>
    apiError("CONFLICT", "TEAM_INVITATION_ALREADY_SENT", {
      message: `${email} already has a pending invitation to this store. The user can send it again from the team page.`,
      i18nKey: "dashboard.team.invitationAlreadySent",
      details: { email, invitationId },
    }),
  limitReached: (limit: MemberLimit) =>
    apiError("CONFLICT", "TEAM_LIMIT_REACHED", {
      // The same for every client: no plan, no way to buy more (OpenAI's guidelines).
      message: "This store has reached its team-member limit. No invitation was created.",
      i18nKey: "dashboard.team.limitReached",
      details: { current: limit.current, limit: limit.limit },
    }),
  ownerNotRemovable: (id: string) =>
    apiError("CONFLICT", "TEAM_OWNER_NOT_REMOVABLE", {
      message: "An owner is never removed from the store, so a store always keeps its owner.",
      i18nKey: "dashboard.team.cannotRemoveOwner",
      details: { id },
    }),
  cannotRemoveSelf: (id: string) =>
    apiError("CONFLICT", "TEAM_CANNOT_REMOVE_SELF", {
      message: "This membership is the caller's own: nobody removes themselves from the store.",
      i18nKey: "dashboard.team.cannotRemoveSelf",
      details: { id },
    }),
  approvalsFull: () =>
    apiError("CONFLICT", "TEAM_APPROVALS_FULL", {
      message: `This store already has ${MAX_OPEN_INVITATION_APPROVALS} invitations waiting for an owner's approval. The user approves or declines them from their links, or they expire after a day.`,
      details: { max: MAX_OPEN_INVITATION_APPROVALS },
    }),
  emailLimit: () =>
    apiError("TOO_MANY_REQUESTS", "TEAM_INVITATION_EMAIL_LIMIT", {
      message: `This store sent ${INVITATION_EMAILS_PER_DAY} invitation e-mails in the last 24 hours, the most it may. Try again later.`,
      i18nKey: "errors.tooManyRequests",
      retryable: true,
      details: { max: INVITATION_EMAILS_PER_DAY },
    }),
  approvalInvalid: (reason: string) =>
    apiError("BAD_REQUEST", "TEAM_APPROVAL_INVALID", {
      message:
        reason === "changed"
          ? "The request changed since the page showed it, and nothing was decided: look at it again, then answer."
          : "This approval link no longer works, or is not for this account.",
      i18nKey: `handoff.refused.${reason}.title`,
      details: { reason },
    }),
  approvalChanged: () =>
    apiError("CONFLICT", "TEAM_APPROVAL_CHANGED", {
      message:
        "The address got a Louez account since the agent asked, so approving would add them at once: the agent asks again.",
      i18nKey: "handoff.team_invitation.done.changed.description",
    }),
  acceptInvalid: () =>
    apiError("NOT_FOUND", "TEAM_INVITATION_INVALID", {
      message: "This invitation is no longer valid.",
      i18nKey: "invitation.errors.invalid",
    }),
  acceptExpired: () =>
    apiError("CONFLICT", "TEAM_INVITATION_EXPIRED", {
      message: "This invitation has expired.",
      i18nKey: "invitation.errors.expired",
    }),
  acceptEmailMismatch: () =>
    apiError("FORBIDDEN", "TEAM_INVITATION_EMAIL_MISMATCH", {
      message: "This invitation is for another e-mail address.",
      i18nKey: "invitation.errors.emailMismatch",
    }),
  acceptAlreadyMember: () =>
    apiError("CONFLICT", "TEAM_ALREADY_MEMBER", {
      message: "You are already a member of this store.",
      i18nKey: "invitation.errors.alreadyMember",
    }),
  acceptLimitReached: (limit: MemberLimit) =>
    apiError("CONFLICT", "TEAM_LIMIT_REACHED", {
      message: "The store's plan has no seat left for a member.",
      i18nKey: "invitation.errors.limitReached",
      details: { current: limit.current, limit: limit.limit },
    }),
  invalidCursor: () =>
    apiError("BAD_REQUEST", "INVALID_CURSOR", {
      message: "This cursor is not one this list returned. Start again without a cursor.",
      i18nKey: "errors.invalidData",
    }),
} as const;
