import { useTranslations } from "next-intl";

import type { ApiHandoffPayload } from "@louez/db";
import { Button } from "@louez/ui";

import { HandoffCard } from "@/components/handoffs/handoff-card";

interface TeamInvitationApprovalProps {
  /** Where the form posts the owner's answer. */
  action: string;
  /** The revision of the request shown: the answer is about it, and no other. */
  revision: number;
  store: string;
  invitation: ApiHandoffPayload;
  /** Why the last answer was not applied, when it was not. */
  note: string | null;
}

/**
 * An agent's team invitation, for an owner to approve or decline: who, as
 * what, whether they join at once, and what they will see. Each answer posts
 * the revision shown, so it decides what the owner read.
 */
export const TeamInvitationApproval = ({
  action,
  revision,
  store,
  invitation,
  note,
}: TeamInvitationApprovalProps) => {
  const t = useTranslations("handoff.team_invitation");
  const { email } = invitation;

  return (
    <HandoffCard title={t("title")} description={t("description", { email, store })} note={note}>
      <div className="w-full space-y-4">
        <ul className="text-muted-foreground list-disc space-y-1 pl-5 text-sm">
          <li>{t("role")}</li>
          <li>{invitation.joinsAtOnce ? t("joinsAtOnce", { email }) : t("byEmail", { email })}</li>
          <li>{t("access")}</li>
        </ul>
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <form method="post" action={action}>
            <input type="hidden" name="decision" value="decline" />
            <input type="hidden" name="revision" value={revision} />
            <Button type="submit" variant="outline" className="w-full sm:w-auto">
              {t("decline")}
            </Button>
          </form>
          <form method="post" action={action}>
            <input type="hidden" name="decision" value="approve" />
            <input type="hidden" name="revision" value={revision} />
            <Button type="submit" className="w-full sm:w-auto">
              {t("approve")}
            </Button>
          </form>
        </div>
      </div>
    </HandoffCard>
  );
};
