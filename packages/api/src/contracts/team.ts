import { z } from "zod";

import { apiError } from "../platform/errors";
import { resourceLinksSchema } from "./links";

/**
 * The team contract: who works in the store, the invitations still pending,
 * and the writes on them. No database here.
 *
 * Roles are `owner` and `member`. An invitation, from the dashboard or an
 * agent, is always for `member`: nothing here makes an owner, and changing a
 * role is done by the user in the dashboard (plan, section 2).
 */

/** Largest page the team lists return, and their default. */
export const TEAM_PAGE_MAX = 100;

/** How long an invitation stays valid, as the dashboard always gave it. */
export const INVITATION_VALIDITY_DAYS = 7;

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

/** The plan's collaborator seats: members other than owners. */
export const memberLimitSchema = z.object({
  /** Members with the `member` role. */
  current: z.number().int(),
  /** Null: unlimited. 0: the plan has no collaborators at all. */
  limit: z.number().int().nullable(),
  /** Whether one more member fits in the plan. */
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
  "The dashboard's team page, where the user invites, resends invitations and manages roles.",
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
      'Always "member", the only role an invitation gives. Owners are never invited; the user changes roles in the dashboard.',
    ),
});
export const inviteMemberOutput = z.object({
  /**
   * `invited`: an invitation went out, valid 7 days. `added`: the person
   * already had a Louez account and joined the store at once.
   */
  outcome: z.enum(["invited", "added"]),
  invitation: teamInvitationSchema.nullable(),
  member: teamMemberSchema.nullable(),
  /**
   * The invitation e-mail: `queued` to be sent, `not_configured` when this
   * instance sends no e-mail (the user shares the link from the dashboard).
   * Null when the person was added.
   */
  invitationEmail: z.enum(["queued", "not_configured"]).nullable(),
  links: teamPageLinks,
});

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
      message:
        limit.limit === 0
          ? "The store's plan has no team members. The user can change plans in the dashboard."
          : `The store's plan allows ${limit.limit} team members, and it has ${limit.current}. The user can change plans in the dashboard.`,
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
  invalidCursor: () =>
    apiError("BAD_REQUEST", "INVALID_CURSOR", {
      message: "This cursor is not one this list returned. Start again without a cursor.",
      i18nKey: "errors.invalidData",
    }),
} as const;
