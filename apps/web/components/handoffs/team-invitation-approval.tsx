import { useTranslations } from "next-intl";

import { DECISION_REASON_MAX } from "@louez/api/contracts/handoffs";
import type { ApiHandoffPayload } from "@louez/db";

import { HandoffCard } from "@/components/handoffs/handoff-card";
import { HandoffDecisionForm } from "@/components/handoffs/handoff-decision-form";

interface TeamInvitationApprovalProps {
  /** Where the form posts the owner's answer. */
  action: string;
  /** The revision of the request shown: the answer is about it, and no other. */
  revision: number;
  /** The digest of what the page shows of the invitation (`invitationShown`). */
  shown: string;
  store: string;
  invitation: ApiHandoffPayload;
  /** Why the last answer was not applied, when it was not. */
  note: string | null;
}

/**
 * An agent's team invitation, for an owner to approve or refuse: who, as
 * what, whether they join at once, and what they will see, with a few words
 * for the agent if they want. The answer posts the revision shown, so it
 * decides what the owner read.
 */
export const TeamInvitationApproval = ({
  action,
  revision,
  shown,
  store,
  invitation,
  note,
}: TeamInvitationApprovalProps) => {
  const t = useTranslations("handoff.team_invitation");
  const { email } = invitation;

  return (
    <HandoffCard title={t("title")} description={t("description", { email, store })} note={note}>
      <HandoffDecisionForm
        action={action}
        revision={revision}
        shown={shown}
        labels={{
          approve: t("approve"),
          refuse: t("decline"),
          reason: t("reason.label"),
          reasonHint: t("reason.hint", { max: DECISION_REASON_MAX }),
        }}
      >
        <ul className="text-muted-foreground list-disc space-y-1 pl-5 text-sm">
          <li>{t("role")}</li>
          <li>{invitation.joinsAtOnce ? t("joinsAtOnce", { email }) : t("byEmail", { email })}</li>
          <li>{t("access")}</li>
        </ul>
      </HandoffDecisionForm>
    </HandoffCard>
  );
};
