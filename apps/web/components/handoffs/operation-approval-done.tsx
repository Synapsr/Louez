import { useFormatter, useTranslations } from "next-intl";

import type { ApprovalPage, ApprovalPageState } from "@louez/api/services/approval-page";

import { HandoffCard } from "@/components/handoffs/handoff-card";
import { ApprovalPreviewSummary } from "@/components/handoffs/approval-preview-summary";

/** The states a result page names: every one but a request still to answer. */
export type EndedApprovalState = Exclude<ApprovalPageState, "pending" | "unreadable">;

/**
 * Where an agent's request stands once it is out of the person's hands, true
 * to its row: approved and waiting for the assistant (with how long it
 * has), carried out, approved and never carried out, refused, or ended
 * without being carried out, and why, with the person's own words if they
 * gave any. Each
 * says what the person can still do: most often nothing, as the assistant
 * asks again if it still needs to. The request it was about follows.
 */
export const OperationApprovalDone = ({
  approval,
  state,
}: {
  approval: ApprovalPage;
  state: EndedApprovalState;
}) => {
  const t = useTranslations("handoff.operation_approval.done");
  const format = useFormatter();
  const when =
    state === "approved"
      ? format.relativeTime(approval.expiresAt, approval.now)
      : state === "completed"
        ? format.relativeTime(approval.completedAt ?? approval.now, approval.now)
        : "";
  // The person's own words with their decision, whichever it was.
  const words = approval.decision?.reason ?? null;

  return (
    <HandoffCard title={t(`${state}.title`)} description={t(`${state}.description`, { when })}>
      {approval.preview && (
        <div className="w-full space-y-3">
          <section className="space-y-1">
            <h2 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
              {t("request")}
            </h2>
            <p className="text-muted-foreground text-sm wrap-anywhere">{approval.store.name}</p>
            <ApprovalPreviewSummary preview={approval.preview} />
            {approval.preview.truncated && (
              <p className="text-muted-foreground text-xs">{t("shortened")}</p>
            )}
          </section>
          {words && (
            <section className="space-y-1">
              <h2 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                {t("yourWords")}
              </h2>
              <p className="text-sm whitespace-pre-line wrap-anywhere">{words}</p>
            </section>
          )}
        </div>
      )}
    </HandoffCard>
  );
};
