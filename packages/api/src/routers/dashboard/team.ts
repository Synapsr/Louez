import {
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
import { checkConfirmation, type ConfirmationPreview } from "../../platform/confirmation";
import { dashboardPageLinks } from "../../platform/links";
import type { UrlsPort } from "../../platform/ports";
import { storeProcedure, type ActorStore } from "../../platform/procedures";
import type { StoreActor } from "../../platform/actor";
import {
  cancelInvitation,
  invitationToken,
  inviteMember,
  listInvitations,
  listMembers,
  removeMember,
  resendInvitation,
  type TeamCaller,
} from "../../services/team";

/**
 * The store's team, on every transport: the dashboard's team page (RPC),
 * `/api/v1/team` (OpenAPI) and the `team_*` MCP tools. The logic is in
 * services/team.ts; this file holds the contract, the rights and the
 * confirmations.
 *
 * No escalation (plan, section 2): an agent may invite someone as a member
 * only, never as an owner, and changing a role stays in the dashboard.
 * Inviting, removing a member and cancelling an invitation always ask an
 * agent to confirm, even a connection whose confirmations are off: each one
 * gives or takes a person's access to the store's data, and an agent cannot
 * undo a removal or a cancellation on its own say.
 */

const MANAGE = { domain: "team", level: "write", role: "manage_members" } as const;
const READ = { domain: "team", level: "read" } as const;

const TEAM_PAGE_HELP =
  "Its `links` hold the dashboard's team page, the URL to give the user: there they change a member's role, send an invitation again or share its link.";

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
 * preview shows. Always asked of an agent, never of a dashboard session.
 */
function confirmAlways<TPreview extends { summary: string }>(
  context: TeamContext,
  path: readonly string[],
  input: unknown,
  describe: (preview: TPreview) => { state: unknown; details: ConfirmationPreview["details"] },
) {
  return (preview: TPreview, tx: Parameters<typeof checkConfirmation>[0]["executor"]) => {
    const { state, details } = describe(preview);
    return checkConfirmation({
      executor: tx,
      actor: context.actor,
      headers: context.headers,
      procedure: path.join("."),
      input,
      state: { state, summary: preview.summary },
      preview: { summary: preview.summary, details },
      always: true,
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
      description: `List the people who work in the store, the newest to join at the top: name, e-mail, role (owner or member) and when they joined. \`memberLimit\` gives the plan's seats for members. Returns up to \`limit\` members (default and maximum 100) and a nextCursor, null on the last page. ${TEAM_PAGE_HELP}`,
      bundle: "team",
    },
  })
  .route({ method: "GET", path: "/team/members" })
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
  .route({ method: "GET", path: "/team/invitations" })
  .input(listInvitationsInput)
  .output(listInvitationsOutput)
  .handler(async ({ context, input }) => ({
    ...(await listInvitations(context.actor.storeId, input)),
    links: teamLinks(context),
  }));

const invite = storeProcedure
  .meta({
    capability: "team.inviteMember",
    scope: MANAGE,
    sensitive: "send",
    mcp: {
      name: "team_invite_member",
      title: "Invite Team Member",
      description: `Invite someone to the store as a member, the only role an invitation gives: a member sees the store's customers, reservations and payments and can change products and reservations. Owners only. Someone who already has a Louez account joins at once (\`outcome: "added"\`); anyone else gets an e-mail with a link valid 7 days (\`outcome: "invited"\`). Refused when they are already a member, when their invitation is pending, or when the plan's seats are full. It always asks for a confirmation, whatever the connection's confirmation setting: the first call answers CONFIRMATION_REQUIRED with a preview naming the address and the role. The answer never holds the invitation's link. ${TEAM_PAGE_HELP}`,
      bundle: "team",
      effect: "additive",
      // The invitation e-mail goes to a person outside the store's account.
      reach: "customer",
    },
  })
  .route({ method: "POST", path: "/team/invitations" })
  .input(inviteMemberInput)
  .output(inviteMemberOutput)
  .handler(async ({ context, input, path }) => {
    const result = await inviteMember(caller(context), input, {
      confirm: confirmAlways(context, path, input, (preview) => ({
        // The address and the role, and whether they join at once.
        state: { email: preview.email, role: preview.role, joinsAtOnce: preview.joinsAtOnce },
        details: {
          email: preview.email,
          role: preview.role,
          joinsAtOnce: preview.joinsAtOnce,
          willSee: ["customers", "reservations", "payments"],
          memberLimit: preview.memberLimit,
        },
      })),
    });
    context.ports.dispatchEffects(result.effectIds);
    return {
      outcome: result.outcome,
      invitation: result.invitation,
      member: result.member,
      invitationEmail: result.invitationEmail,
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
  .route({ method: "POST", path: "/team/invitations/{id}/cancel" })
  .input(cancelInvitationInput)
  .output(cancelInvitationOutput)
  .handler(async ({ context, input, path }) => {
    const result = await cancelInvitation(caller(context), input.id, {
      confirm: confirmAlways(context, path, input, (preview) => ({
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
  .route({ method: "DELETE", path: "/team/members/{id}" })
  .input(removeMemberInput)
  .output(removeMemberOutput)
  .handler(async ({ context, input, path }) => {
    const result = await removeMember(caller(context), input.id, {
      confirm: confirmAlways(context, path, input, (preview) => ({
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

export const dashboardTeamRouter = {
  listMembers: listMembersProcedure,
  listInvitations: listInvitationsProcedure,
  invite,
  cancelInvitation: cancel,
  removeMember: remove,
  resendInvitation: resend,
  invitationLink,
};
