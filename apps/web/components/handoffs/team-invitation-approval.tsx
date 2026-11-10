import { useTranslations } from "next-intl";

import type { ApiHandoffPayload } from "@louez/db";
import { Button } from "@louez/ui";

import { HandoffCard } from "@/components/handoffs/handoff-card";

interface TeamInvitationApprovalProps {
  /** Where the form posts the owner's answer. */
  action: string;
  store: string;
  invitation: ApiHandoffPayload;
  /** The last answer could not be applied. */
  failed: boolean;
}

/**
 * An agent's team invitation, for an owner to approve or decline: who, as
 * what, whether they join at once, and what they will see.
 */
export const TeamInvitationApproval = ({
  action,
  store,
  invitation,
  failed,
}: TeamInvitationApprovalProps) => {
  const t = useTranslations("handoff.team_invitation");
  const { email } = invitation;

  return (
    <HandoffCard
      title={t("title")}
      description={t("description", { email, store })}
      note={failed ? t("error.failed") : null}
    >
      <div className="w-full space-y-4">
        <ul className="text-muted-foreground list-disc space-y-1 pl-5 text-sm">
          <li>{t("role")}</li>
          <li>{invitation.joinsAtOnce ? t("joinsAtOnce", { email }) : t("byEmail", { email })}</li>
          <li>{t("access")}</li>
        </ul>
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <form method="post" action={action}>
            <input type="hidden" name="decision" value="decline" />
            <Button type="submit" variant="outline" className="w-full sm:w-auto">
              {t("decline")}
            </Button>
          </form>
          <form method="post" action={action}>
            <input type="hidden" name="decision" value="approve" />
            <Button type="submit" className="w-full sm:w-auto">
              {t("approve")}
            </Button>
          </form>
        </div>
      </div>
    </HandoffCard>
  );
};
