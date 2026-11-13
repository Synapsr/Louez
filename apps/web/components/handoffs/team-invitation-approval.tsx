import { useTranslations } from "next-intl";

import { DECISION_REASON_MAX } from "@louez/api/contracts/handoffs";
import type { ApiHandoffPayload } from "@louez/db";
import { Button, Label, Textarea } from "@louez/ui";

import { HandoffCard } from "@/components/handoffs/handoff-card";

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
      <form method="post" action={action} className="w-full space-y-4">
        <ul className="text-muted-foreground list-disc space-y-1 pl-5 text-sm">
          <li>{t("role")}</li>
          <li>{invitation.joinsAtOnce ? t("joinsAtOnce", { email }) : t("byEmail", { email })}</li>
          <li>{t("access")}</li>
        </ul>
        <input type="hidden" name="revision" value={revision} />
        <input type="hidden" name="shown" value={shown} />
        <div className="space-y-2">
          <Label htmlFor="handoff-reason">{t("reason.label")}</Label>
          <Textarea
            id="handoff-reason"
            name="reason"
            maxLength={DECISION_REASON_MAX}
            rows={2}
            aria-describedby="handoff-reason-hint"
          />
          <p id="handoff-reason-hint" className="text-muted-foreground text-xs">
            {t("reason.hint", { max: DECISION_REASON_MAX })}
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button
            type="submit"
            name="decision"
            value="refuse"
            variant="outline"
            className="w-full sm:w-auto"
          >
            {t("decline")}
          </Button>
          <Button type="submit" name="decision" value="approve" className="w-full sm:w-auto">
            {t("approve")}
          </Button>
        </div>
      </form>
    </HandoffCard>
  );
};
