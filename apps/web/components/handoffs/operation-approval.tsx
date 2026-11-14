import { useFormatter, useTranslations } from "next-intl";

import { DECISION_REASON_MAX } from "@louez/api/contracts/handoffs";
import type { Consequence } from "@louez/api/platform/approval-rule";
import type { ApprovalPage, ShownPreview } from "@louez/api/services/approval-page";
import { Alert, AlertTitle } from "@louez/ui";
import { WarningIcon } from "@louez/ui/icons";

import { ApprovalAgentName } from "@/components/handoffs/approval-agent-name";
import { ApprovalDetails } from "@/components/handoffs/approval-details";
import { ApprovalPreviewSummary } from "@/components/handoffs/approval-preview-summary";
import { HandoffCard } from "@/components/handoffs/handoff-card";
import { HandoffDecisionForm } from "@/components/handoffs/handoff-decision-form";
import { HandoffDisclosure } from "@/components/handoffs/handoff-disclosure";

/**
 * The consequences that cannot be undone, the gravest first: the first one a
 * request carries names the page, and the note names them all, in this order.
 */
const ORDER = [
  "access_removed",
  "money",
  "stock_override",
  "deletion",
  "customer_message",
  "credits",
] as const satisfies readonly Consequence[];

/** Under this long left to answer, the lapse shows on the screen itself; otherwise in the details. */
export const LAPSE_SOON_MS = 60 * 60_000;

interface OperationApprovalProps {
  /** Where the form posts the person's answer. */
  action: string;
  approval: ApprovalPage & { preview: ShownPreview; binding: string };
  /** The signed-in account the assistant acts for. */
  email: string;
  /** Why the last answer was not applied, or that the request changed while the page was open. */
  note: string | null;
}

/**
 * An agent's request a person approves or refuses, on a phone as often as
 * not, decided from one screen: what kind of action, the one sentence of
 * what Louez will do, that only Louez's summary counts, what cannot be
 * undone, the lapse when it is close, the box when one is required, and the
 * two buttons. Everything else is on request, in closed disclosures: who
 * asks and for which account, what Louez checked, when it worked it out and
 * when the request lapses, the fuller safety sentence ("Details"), and the
 * words for the assistant ("Add a note"), which are posted either way. The
 * answer posts the revision and the binding shown, so it decides what the
 * person read.
 */
export const OperationApproval = ({ action, approval, email, note }: OperationApprovalProps) => {
  const t = useTranslations("handoff.operation_approval");
  const format = useFormatter();
  const stakes = ORDER.filter((consequence) => approval.consequences.includes(consequence));
  const headline =
    stakes[0] ?? (approval.consequences.includes("change") ? "change" : "unknown");
  const lapsesSoon = approval.expiresAt.getTime() - approval.now.getTime() <= LAPSE_SOON_MS;

  return (
    <HandoffCard title={t(`title.${headline}`)} note={note}>
      <HandoffDecisionForm
        action={action}
        revision={approval.revision}
        shown={approval.binding}
        labels={{
          approve: t("approve"),
          refuse: t("refuse"),
          reason: t("reason.label"),
          reasonHint: t("reason.hint", { max: DECISION_REASON_MAX }),
          reasonDisclosure: t("reason.toggle"),
          ...(approval.deliberate ? { acknowledge: t("acknowledge") } : {}),
        }}
      >
        <div className="space-y-1">
          <ApprovalPreviewSummary preview={approval.preview} />
          <p className="text-muted-foreground text-xs">{t("trustShort")}</p>
        </div>
        {stakes.length > 0 && (
          <Alert variant="warning" role="note">
            <WarningIcon aria-hidden="true" />
            <AlertTitle>
              {t("stakes", {
                list: format.list(
                  stakes.map((stake) => t(`stake.${stake}`)),
                  { type: "conjunction" },
                ),
              })}
            </AlertTitle>
          </Alert>
        )}
        {lapsesSoon && (
          <p className="text-sm">
            {t("lapsesSoon", { when: format.relativeTime(approval.expiresAt, approval.now) })}
          </p>
        )}
        <HandoffDisclosure label={t("details")}>
          <section className="space-y-1">
            <h2 className="text-muted-foreground text-xs font-medium">{t("askedBy")}</h2>
            <ApprovalAgentName agent={approval.agent} />
            <p className="text-muted-foreground text-sm wrap-anywhere">
              {t("forAccount", { email, store: approval.store.name })}
            </p>
          </section>
          {approval.preview.details.length > 0 && (
            <section className="space-y-1">
              <h2 className="text-muted-foreground text-xs font-medium">{t("checked")}</h2>
              <ApprovalDetails entries={approval.preview.details} />
            </section>
          )}
          <p className="text-muted-foreground text-sm">
            {t("computedAt", { when: format.relativeTime(approval.computedAt, approval.now) })}{" "}
            {t("expires", { when: format.relativeTime(approval.expiresAt, approval.now) })}
          </p>
          <p className="text-muted-foreground text-sm">{t("trust")}</p>
        </HandoffDisclosure>
      </HandoffDecisionForm>
    </HandoffCard>
  );
};
