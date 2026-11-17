import type { ShownPreview } from "@louez/api/services/approval-page";

/**
 * The sentence of an approval's preview, as one paragraph: the reader put it
 * on one line (`oneLine`), so text from the store's records draws no line
 * of its own. Its box clips what it would draw past itself (marks stacked
 * above or below the line), so nothing in it covers what follows; a long
 * word breaks only when nothing else can.
 */
export const ApprovalPreviewSummary = ({ preview }: { preview: Pick<ShownPreview, "summary"> }) => (
  <p className="text-foreground overflow-hidden text-base leading-relaxed font-medium wrap-break-word">
    {preview.summary}
  </p>
);
