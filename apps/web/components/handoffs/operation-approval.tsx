import type { ComponentType, SVGProps } from "react";

import { useFormatter, useTranslations } from "next-intl";

import { DECISION_REASON_MAX } from "@louez/api/contracts/handoffs";
import type { Consequence } from "@louez/api/platform/approval-rule";
import type { ApprovalPage, ShownPreview } from "@louez/api/services/approval-page";
import { Alert, AlertDescription, AlertTitle } from "@louez/ui";
import {
  ClockIcon,
  MailIcon,
  PackageIcon,
  ShieldCheckIcon,
  SparklesIcon,
  TrashSolidIcon,
  UnlinkIcon,
  WalletIcon,
} from "@louez/ui/icons";

import { ApprovalAgentName } from "@/components/handoffs/approval-agent-name";
import { ApprovalDetails } from "@/components/handoffs/approval-details";
import { ApprovalPreviewSummary } from "@/components/handoffs/approval-preview-summary";
import { HandoffCard } from "@/components/handoffs/handoff-card";
import { HandoffDecisionForm } from "@/components/handoffs/handoff-decision-form";

/**
 * The consequences an approval can carry, the gravest first: the first one
 * a request carries names the page, and each is shown in this order.
 */
const ORDER = [
  "access_removed",
  "money",
  "stock_override",
  "deletion",
  "customer_message",
  "credits",
] as const satisfies readonly Consequence[];
type Shown = (typeof ORDER)[number];

const ICONS: Record<Shown, ComponentType<SVGProps<SVGSVGElement>>> = {
  access_removed: UnlinkIcon,
  money: WalletIcon,
  stock_override: PackageIcon,
  deletion: TrashSolidIcon,
  customer_message: MailIcon,
  credits: SparklesIcon,
};

/** What cannot be put back is a warning; what can, information. */
const WARNS: ReadonlySet<Shown> = new Set(["access_removed", "money", "stock_override", "deletion"]);

const shownConsequences = (consequences: readonly Consequence[]): Shown[] =>
  ORDER.filter((consequence) => consequences.includes(consequence));

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
 * not: what Louez will do (its own preview, stored when the agent last
 * asked, as plain text), what it puts at stake, who asks and for whom, when
 * Louez worked it out and how long is left, then the answer. Approving
 * anything but a plain change asks for a box to be ticked first, so a
 * careless tap approves nothing. The answer posts the revision and the
 * binding shown, so it decides what the person read.
 */
export const OperationApproval = ({ action, approval, email, note }: OperationApprovalProps) => {
  const t = useTranslations("handoff.operation_approval");
  const format = useFormatter();
  const consequences = shownConsequences(approval.consequences);
  const headline = consequences[0] ?? "change";

  return (
    <HandoffCard
      title={t(`title.${headline}`)}
      description={t("description", { store: approval.store.name, email })}
      note={note}
    >
      <HandoffDecisionForm
        action={action}
        revision={approval.revision}
        shown={approval.binding}
        labels={{
          approve: t("approve"),
          refuse: t("refuse"),
          reason: t("reason.label"),
          reasonHint: t("reason.hint", { max: DECISION_REASON_MAX }),
          ...(approval.deliberate ? { acknowledge: t("acknowledge") } : {}),
        }}
      >
        <section className="space-y-2">
          <h2 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            {t("what")}
          </h2>
          <ApprovalPreviewSummary preview={approval.preview} />
        </section>
        {consequences.map((consequence) => {
          const Icon = ICONS[consequence];
          return (
            <Alert key={consequence} role="note" variant={WARNS.has(consequence) ? "warning" : "info"}>
              <Icon aria-hidden="true" />
              <AlertTitle>{t(`consequence.${consequence}.title`)}</AlertTitle>
              <AlertDescription>{t(`consequence.${consequence}.description`)}</AlertDescription>
            </Alert>
          );
        })}
        <section className="space-y-2">
          <h2 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            {t("askedBy")}
          </h2>
          <ApprovalAgentName agent={approval.agent} />
        </section>
        {approval.preview.details.length > 0 && (
          <section className="space-y-2">
            <h2 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
              {t("details")}
            </h2>
            <ApprovalDetails entries={approval.preview.details} />
          </section>
        )}
        <div className="text-muted-foreground space-y-1 text-sm">
          <p className="flex items-start gap-2">
            <ClockIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>
              {t("computedAt", { when: format.relativeTime(approval.computedAt, approval.now) })}{" "}
              {t("expires", { when: format.relativeTime(approval.expiresAt, approval.now) })}
            </span>
          </p>
          <p className="flex items-start gap-2">
            <ShieldCheckIcon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <span>{t("trust")}</span>
          </p>
        </div>
      </HandoffDecisionForm>
    </HandoffCard>
  );
};
