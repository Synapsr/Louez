import {
  INVITATION_EMAILS_PER_DAY,
  MAX_OPEN_INVITATION_APPROVALS,
  TEAM_PAGE_MAX,
  acceptInvitationInput,
  acceptInvitationOutput,
  cancelInvitationInput,
  cancelInvitationOutput,
  invitationLinkInput,
  invitationLinkOutput,
  inviteMemberInput,
  inviteMemberOutput,
  listInvitationsInput,
  listInvitationsOutput,
  listMembersInput,
  listMembersOutput,
  removeMemberInput,
  removeMemberOutput,
  resendInvitationInput,
  resendInvitationOutput,
} from "../../contracts/team";
import { HANDOFF_TTL_HOURS } from "../../contracts/handoffs";
import type { Consequences } from "../../platform/approval-rule";
import { checkConfirmation, type ConfirmationPreview } from "../../platform/confirmation";
import { dashboardPageLinks } from "../../platform/links";
import type { UrlsPort } from "../../platform/ports";
import {
  accountProcedure,
  missingTransport,
  storeProcedure,
  type ActorStore,
} from "../../platform/procedures";
import type { StoreActor } from "../../platform/actor";
import { upgradeStoredLink } from "../../services/handoffs";
import {
  acceptInvitation,
  cancelInvitation,
  invitationToken,
  inviteMember,
  listInvitations,
  listMembers,
  removeMember,
  requestInvitationApproval,
  resendInvitation,
  type TeamCaller,
} from "../../services/team";

/**
 * The store's team, on every transport: the dashboard's team page (RPC),
 * `/api/v1/team` (OpenAPI) and the `team_*` MCP tools. The logic is in
 * services/team.ts; this file holds the contract, the rights and the
 * confirmations.
 *
 * No escalation (plan, section 2): an invitation is for a member only,
 * never an owner, and no procedure changes a role. An agent's invitation
 * creates nothing: an owner approves it from a link (a `team_invitation`
 * handoff, answered through `handoffs.decide`), as a confirmation token the
 * agent holds would prove nothing.
 * Removing a member and cancelling an invitation always ask an agent to
 * confirm, even a connection whose confirmations are off: each one takes a
 * person's access away, and an agent cannot undo it on its own say.
 */

const MANAGE = { domain: "team", level: "write", role: "manage_members" } as const;
const READ = { domain: "team", level: "read" } as const;

const TEAM_PAGE_HELP =
  "Its `links` hold the dashboard's team page, the URL to give the user: there they send an invitation again or share its link.";

/** The REST reference's own texts (`.route({ description })`), for a developer. */
const REST_TEAM_PAGE_NOTE =
  "`links.dashboard` is the team page in the Louez dashboard, where invitations are sent again and their links shared.";

const REST_OWNERS_ONLY = "Only a key of an owner of the store may call it.";

const REST_ALWAYS_CONFIRMED =
  "It always asks for a confirmation first (412 `CONFIRMATION_REQUIRED`), whatever the key's confirmation setting, with a preview naming the person.";

const REST_PAGE_NOTE = `Returns up to \`limit\` rows (${TEAM_PAGE_MAX} by default and at most); pass \`nextCursor\` back as \`cursor\` to read on, null on the last page. A cursor this list did not return answers \`INVALID_CURSOR\`.`;

interface TeamContext {
  actor: StoreActor;
  store: ActorStore;
  ports: TeamCaller["ports"] & { urls: UrlsPort };
  headers: Headers;
}

const teamLinks = (context: Pick<TeamContext, "ports" | "store">) =>
  dashboardPageLinks(context.ports.urls, context.store, "/dashboard/team");

const caller = (context: TeamContext): TeamCaller => ({
  storeId: context.actor.storeId,
  userId: context.actor.credential.userId,
  store: context.store,
  ports: context.ports,
});

/**
 * Asks for the confirmation under the write's lock, bound to what the
 * preview shows (its state and summary). `describe` declares the
 * consequences of the branch the preview shows.
 */
function confirmTeamChange<TPreview extends { summary: string }>(
  context: TeamContext,
  path: readonly string[],
  input: unknown,
  describe: (preview: TPreview) => {
    state: unknown;
    details: ConfirmationPreview["details"];
    consequences: Consequences;
  },
) {
  return (preview: TPreview, tx: Parameters<typeof checkConfirmation>[0]["executor"]) => {
    const { state, details, consequences } = describe(preview);
    return checkConfirmation({
      consequences,
      executor: tx,
      actor: context.actor,
      headers: context.headers,
      procedure: path.join("."),
      input,
      state: { state, summary: preview.summary },
      preview: { summary: preview.summary, details },
    });
  };
}

const listMembersProcedure = storeProcedure
  .meta({
    capability: "team.listMembers",
    scope: READ,
    mcp: {
      name: "team_list_members",
      title: "List Team Members",
      description: `List the people who work in the store, the newest to join at the top: name, e-mail, role (owner or member) and when they joined. \`memberLimit\` is the store's team-member allowance. Returns up to \`limit\` members (default and maximum 100) and a nextCursor, null on the last page. ${TEAM_PAGE_HELP}`,
      bundle: "team",
    },
  })
  .route({
    method: "GET",
    path: "/team/members",
    description: `Lists the people who work in the store, the newest to join first: name, e-mail, role (\`owner\` or \`member\`) and when they joined. Each \`id\` is the membership's, which \`DELETE /team/members/{id}\` takes. \`memberLimit\` is the store's allowance of members, owners aside: \`current\`, \`limit\` (null: unlimited) and \`canAddMember\`. ${REST_PAGE_NOTE} ${REST_TEAM_PAGE_NOTE}`,
  })
  .input(listMembersInput)
  .output(listMembersOutput)
  .handler(async ({ context, input }) => ({
    ...(await listMembers(context.actor.storeId, input, context.ports)),
    links: teamLinks(context),
  }));

const listInvitationsProcedure = storeProcedure
  .meta({
    capability: "team.listInvitations",
    scope: READ,
    mcp: {
      name: "team_list_invitations",
      title: "List Team Invitations",
      description: `List the store's pending invitations, the newest at the top: the e-mail invited, the role, when it was sent and when it expires (\`expired\` once past). Returns up to \`limit\` invitations (default and maximum 100) and a nextCursor, null on the last page. ${TEAM_PAGE_HELP}`,
      bundle: "team",
    },
  })
  .route({
    method: "GET",
    path: "/team/invitations",
    description: `Lists the store's pending invitations, the newest first: the e-mail invited, the role, when it was sent (\`invitedAt\`) and when it expires (\`expiresAt\`; \`expired\` is true once past, when its link no longer works). Each \`id\` is what \`POST /team/invitations/{id}/cancel\` takes. ${REST_PAGE_NOTE} ${REST_TEAM_PAGE_NOTE}`,
  })
  .input(listInvitationsInput)
  .output(listInvitationsOutput)
  .handler(async ({ context, input }) => ({
    ...(await listInvitations(context.actor.storeId, input)),
    links: teamLinks(context),
  }));

/** An answer of `invite` kept for its idempotency key, its approval's view as views are now. */
function upgradeStoredInvite(stored: unknown, urls: UrlsPort): unknown {
  if (!stored || typeof stored !== "object" || !("approval" in stored)) return stored;
  return { ...stored, approval: upgradeStoredLink(stored.approval, urls) };
}

const invite = storeProcedure
  .meta({
    capability: "team.inviteMember",
    scope: MANAGE,
    // Its answers stored before views carried `decision` replay with it.
    upgradeReplay: upgradeStoredInvite,
    mcp: {
      name: "team_invite_member",
      title: "Invite Team Member",
      description: `Ask to invite someone to the store as a member, the only role an invitation gives: a member sees the store's customers, reservations and payments and can change products and reservations. Owners only. Nothing is created yet: the answer (\`outcome: "approval_requested"\`) holds \`approval.url\`, a link to give the user as is, and the user approves the invitation from the link, signed in as an owner of the store, within 24 hours. handoffs_get with \`approval.handoff.id\` follows it: \`decision\` says what the user decided (approved or refused), when, and the words they added, if any; the step is completed once approved and carried out (the invitation e-mail went out, or someone with a Louez account joined at once), and failed when refused, or approved but no longer possible (\`failure\` says why). The same address asked again gets the same approval and link, with 24 more hours to answer; a page the user opened before that shows the request again rather than approve it. Refused when the person is already a member, when an invitation of theirs is pending, when the store has reached its team-member limit, when ${MAX_OPEN_INVITATION_APPROVALS} approvals are already open, or past the store's ${INVITATION_EMAILS_PER_DAY} invitation e-mails a day. ${TEAM_PAGE_HELP}`,
      bundle: "team",
      effect: "additive",
    },
  })
  .route({
    method: "POST",
    path: "/team/invitations",
    description: `Asks to invite someone to the store as a member, the only role an invitation gives: a member sees the store's customers, reservations and payments and can change products and reservations. ${REST_OWNERS_ONLY} With an API key, the call creates no invitation and sends no e-mail: it answers \`outcome: "approval_requested"\` with \`approval.url\`, a link to the request's page in Louez that works for ${HANDOFF_TTL_HOURS} hours, and \`approval.handoff\`, the step \`GET /handoffs/{id}\` reads by its \`id\`. The same address asked again gets the same link, for ${HANDOFF_TTL_HOURS} more hours. Refused with \`TEAM_ALREADY_MEMBER\` when the person is already a member, \`TEAM_INVITATION_ALREADY_SENT\` when an invitation of theirs is pending, \`TEAM_LIMIT_REACHED\` when the store has reached its member allowance, \`TEAM_APPROVALS_FULL\` when ${MAX_OPEN_INVITATION_APPROVALS} such requests are already open, and \`TEAM_INVITATION_EMAIL_LIMIT\` past the store's ${INVITATION_EMAILS_PER_DAY} invitation e-mails in 24 hours. ${REST_TEAM_PAGE_NOTE}`,
  })
  .input(inviteMemberInput)
  .output(inviteMemberOutput)
  .handler(async ({ context, input }) => {
    const { credential } = context.actor;
    if (credential.kind !== "session") {
      const approval = await requestInvitationApproval(
        caller(context),
        {
          storeId: context.actor.storeId,
          userId: credential.userId,
          credentialKind: credential.kind,
          credentialId: credential.id,
          clientName: credential.clientName,
        },
        input,
        context.ports.urls,
      );
      return {
        outcome: "approval_requested" as const,
        invitation: null,
        member: null,
        invitationEmail: null,
        approval,
        links: teamLinks(context),
      };
    }
    const result = await inviteMember(caller(context), input);
    context.ports.dispatchEffects(result.effectIds);
    return {
      outcome: result.outcome,
      invitation: result.invitation,
      member: result.member,
      invitationEmail: result.invitationEmail,
      approval: null,
      links: teamLinks(context),
    };
  });

const cancel = storeProcedure
  .meta({
    capability: "team.cancelInvitation",
    scope: MANAGE,
    sensitive: "destructive",
    mcp: {
      name: "team_cancel_invitation",
      title: "Cancel Team Invitation",
      description: `Cancel a pending invitation: its link stops working and the person does not join. Owners only. It always asks for a confirmation, whatever the connection's confirmation setting: the first call answers CONFIRMATION_REQUIRED with a preview naming the person. ${TEAM_PAGE_HELP}`,
      bundle: "team",
      effect: "overwrite",
    },
  })
  .route({
    method: "POST",
    path: "/team/invitations/{id}/cancel",
    description: `Cancels a pending invitation: its link stops working and the person does not join. Takes the invitation's \`id\` from \`GET /team/invitations\`; one that is not a pending invitation of the store answers \`TEAM_INVITATION_NOT_FOUND\`. ${REST_OWNERS_ONLY} ${REST_ALWAYS_CONFIRMED} Returns the invitation's \`id\` and \`email\`. ${REST_TEAM_PAGE_NOTE}`,
  })
  .input(cancelInvitationInput)
  .output(cancelInvitationOutput)
  .handler(async ({ context, input, path }) => {
    const result = await cancelInvitation(caller(context), input.id, {
      confirm: confirmTeamChange(context, path, input, (preview) => ({
        // The invitation's link stops letting the person in.
        consequences: ["access_removed"],
        state: {
          id: preview.invitation.id,
          email: preview.invitation.email,
          role: preview.invitation.role,
          expiresAt: preview.invitation.expiresAt.toISOString(),
        },
        details: { invitation: preview.invitation },
      })),
    });
    return { ...result, cancelled: true as const, links: teamLinks(context) };
  });

const remove = storeProcedure
  .meta({
    capability: "team.removeMember",
    scope: MANAGE,
    sensitive: "destructive",
    mcp: {
      name: "team_remove_member",
      title: "Remove Team Member",
      description: `Remove a member from the store: they lose access to it at once. Takes the membership's id from team_list_members. Owners only. An owner is never removed, and nobody removes themselves. It always asks for a confirmation, whatever the connection's confirmation setting: the first call answers CONFIRMATION_REQUIRED with a preview naming the person. ${TEAM_PAGE_HELP}`,
      bundle: "team",
      effect: "delete",
    },
  })
  .route({
    method: "DELETE",
    path: "/team/members/{id}",
    description: `Removes a member from the store: they lose access to it at once, and their pending invitations to the store are cancelled. Takes the membership's \`id\` from \`GET /team/members\`, not the user id. ${REST_OWNERS_ONLY} Refused with \`TEAM_CANNOT_REMOVE_SELF\` for the membership of the user the key belongs to, \`TEAM_OWNER_NOT_REMOVABLE\` for an owner, and \`TEAM_MEMBER_NOT_FOUND\` for an id the store does not have. ${REST_ALWAYS_CONFIRMED} Returns the membership's \`id\`, the member's \`userId\` and \`email\`. ${REST_TEAM_PAGE_NOTE}`,
  })
  .input(removeMemberInput)
  .output(removeMemberOutput)
  .handler(async ({ context, input, path }) => {
    const result = await removeMember(caller(context), input.id, {
      confirm: confirmTeamChange(context, path, input, (preview) => ({
        consequences: ["access_removed"],
        state: {
          id: preview.member.id,
          userId: preview.member.userId,
          email: preview.member.email,
          role: preview.member.role,
        },
        details: { member: preview.member },
      })),
    });
    return { ...result, removed: true as const, links: teamLinks(context) };
  });

// Sending an invitation again and reading its link stay in the dashboard:
// the link is the invitation's credential, and an agent never holds it.
const dashboardOnly = storeProcedure.meta({
  actors: ["session"],
  mcp: { exclude: "the invitation's link is its credential: the dashboard only" },
});

const resend = dashboardOnly
  .meta({ capability: "team.resendInvitation", scope: MANAGE, sensitive: "send" })
  .input(resendInvitationInput)
  .output(resendInvitationOutput)
  .handler(async ({ context, input }) => {
    const { effectIds, ...result } = await resendInvitation(caller(context), input.id);
    context.ports.dispatchEffects(effectIds);
    return result;
  });

/** The link the dashboard copies when this instance sends no e-mail. */
const invitationLink = dashboardOnly
  .meta({
    capability: "team.getInvitationLink",
    scope: { domain: "team", level: "read", role: "manage_members" },
  })
  .input(invitationLinkInput)
  .output(invitationLinkOutput)
  .handler(async ({ context, input }) => ({
    url: context.ports.urls.dashboard(
      `/invitation/${await invitationToken(context.actor.storeId, input.id)}`,
    ),
  }));

/**
 * The invited person accepts, from the invitation's page: a session only,
 * before they belong to the store. The store becomes their active one.
 */
const acceptInvitationProcedure = accountProcedure
  .meta({
    capability: "team.acceptInvitation",
    scope: { domain: "team", level: "write" },
    actors: ["session"],
    secretOutput: true,
    mcp: { exclude: "joining a store gives the caller a role: the invited person only" },
  })
  .input(acceptInvitationInput)
  .output(acceptInvitationOutput)
  .handler(async ({ context, input }) => {
    const { ports } = context;
    if (!ports) throw missingTransport();
    const accepted = await acceptInvitation(
      { ...input, userId: context.actor.credential.userId },
      ports,
    );
    for (const cookie of ports.newStores.onboardingCookies({
      activeStoreId: accepted.storeId,
      spendReferral: false,
    })) {
      context.resHeaders?.append("set-cookie", cookie);
    }
    return accepted;
  });

export const dashboardTeamRouter = {
  listMembers: listMembersProcedure,
  listInvitations: listInvitationsProcedure,
  invite,
  cancelInvitation: cancel,
  removeMember: remove,
  resendInvitation: resend,
  invitationLink,
  acceptInvitation: acceptInvitationProcedure,
};
