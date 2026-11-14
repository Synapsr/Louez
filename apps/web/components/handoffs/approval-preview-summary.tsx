import type { ShownPreview } from "@louez/api/services/approval-page";

/** The sentence of an approval's preview, as text: line breaks kept, long words broken on a narrow screen. */
export const ApprovalPreviewSummary = ({ preview }: { preview: Pick<ShownPreview, "summary"> }) => (
  <p className="text-foreground text-base font-medium whitespace-pre-line wrap-anywhere">
    {preview.summary}
  </p>
);
