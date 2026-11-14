import type { ShownPreview } from "@louez/api/services/approval-page";

/**
 * The sentence of an approval's preview, as one paragraph: the reader put it
 * on one line (`oneLine`), so text from the store's records draws no line
 * of its own; long words break on a narrow screen.
 */
export const ApprovalPreviewSummary = ({ preview }: { preview: Pick<ShownPreview, "summary"> }) => (
  <p className="text-foreground text-base font-medium wrap-anywhere">{preview.summary}</p>
);
