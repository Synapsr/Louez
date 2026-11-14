import { useFormatter, useTranslations } from "next-intl";

import type { ApprovalPage, ApprovalPageState } from "@louez/api/services/approval-page";

import { ApprovalPreviewSummary } from "@/components/handoffs/approval-preview-summary";
import { HandoffCard } from "@/components/handoffs/handoff-card";
import { HandoffDisclosure } from "@/components/handoffs/handoff-disclosure";

/** The states a result page names: every one but a request still to answer. */
export type EndedApprovalState = Exclude<ApprovalPageState, "pending" | "unreadable">;

/**
 * Where an agent's request stands once it is out of the person's hands,
 * true to its row, in one line: approved, carried out, lapsed, refused, or
 * ended without being carried out. On request, in a closed disclosure: what
 * that means and what the person can still do (most often nothing, as the
 * assistant asks again if it still needs to), the request it was about, and
 * the person's own words if they gave any.
 */
export const OperationApprovalDone = ({
  approval,
  state,
}: {
  approval: ApprovalPage;
  state: EndedApprovalState;
}) => {
  const t = useTranslations("handoff.operation_approval");
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
    <HandoffCard title={t(`done.${state}.title`)}>
      <div className="w-full">
        <HandoffDisclosure label={t("details")}>
          <p className="text-muted-foreground text-sm">{t(`done.${state}.description`, { when })}</p>
          {approval.preview && (
            <section className="space-y-1">
              <h2 className="text-muted-foreground text-xs font-medium">{t("done.request")}</h2>
              <p className="text-muted-foreground text-sm wrap-break-word">{approval.store.name}</p>
              <ApprovalPreviewSummary preview={approval.preview} />
              {approval.preview.truncated && (
                <p className="text-muted-foreground text-xs">{t("done.shortened")}</p>
              )}
            </section>
          )}
          {words && (
            <section className="space-y-1">
              <h2 className="text-muted-foreground text-xs font-medium">{t("done.yourWords")}</h2>
              <p className="text-sm whitespace-pre-line wrap-break-word">{words}</p>
            </section>
          )}
        </HandoffDisclosure>
      </div>
    </HandoffCard>
  );
};
