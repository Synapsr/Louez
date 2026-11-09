import { and, eq, gt } from "drizzle-orm";

import type {
  ApiEffectPayloads,
  ApiEffectSenders,
  EffectSendContext,
} from "@louez/api/platform/effects";
import { db, storeInvitations } from "@louez/db";
import { isEmailConfigured } from "@louez/email";

import { withEffectSignal } from "@/lib/api/effect-signal";
import { apiUrls } from "@/lib/api/urls";
import { getLocaleFromCountry } from "@/lib/email/i18n";
import { sendTeamInvitationEmail } from "@/lib/email/send";

// The sender of a team invitation's e-mail (packages/api services/team.ts).
// The address and the token are read from the invitation when it goes out:
// one cancelled, accepted or expired since sends nothing, and one sent again
// links its new token. It throws when the e-mail did not go out (the row is
// retried) and answers `skipped` when there is nothing to send.

type Payload = ApiEffectPayloads["team.invitationEmail"];

/** What the sender calls. A test replaces them, so nothing leaves the machine. */
export interface TeamInvitationEffectDeps {
  isEmailConfigured: typeof isEmailConfigured;
  readPendingInvitation: typeof readPendingInvitation;
  sendTeamInvitationEmail: typeof sendTeamInvitationEmail;
}

/** The address and the token of an invitation still pending and valid, or null. */
async function readPendingInvitation(
  id: string,
): Promise<{ email: string; token: string } | null> {
  const [invitation] = await db
    .select({ email: storeInvitations.email, token: storeInvitations.token })
    .from(storeInvitations)
    .where(
      and(
        eq(storeInvitations.id, id),
        eq(storeInvitations.status, "pending"),
        gt(storeInvitations.expiresAt, new Date()),
      ),
    )
    .limit(1);
  return invitation ?? null;
}

const defaultDeps: TeamInvitationEffectDeps = {
  isEmailConfigured,
  readPendingInvitation,
  sendTeamInvitationEmail,
};

export function createTeamInvitationEffectSenders(
  overrides: Partial<TeamInvitationEffectDeps> = {},
): Pick<ApiEffectSenders, "team.invitationEmail"> {
  const deps: TeamInvitationEffectDeps = { ...defaultDeps, ...overrides };

  return {
    "team.invitationEmail": (payload: Payload, context: EffectSendContext) =>
      withEffectSignal(context, async () => {
        if (!deps.isEmailConfigured()) return { skipped: "email_not_configured" };

        const invitation = await deps.readPendingInvitation(payload.invitationId);
        if (!invitation) return { skipped: "invitation_not_pending" };

        await context.assertClaim();
        await deps.sendTeamInvitationEmail({
          to: invitation.email,
          storeName: payload.store.name,
          storeLogoUrl: payload.store.logoUrl,
          inviterName: payload.inviterName,
          invitationUrl: apiUrls.dashboard(`/invitation/${invitation.token}`),
          locale: getLocaleFromCountry(payload.store.country),
        });
      }),
  };
}
