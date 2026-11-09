import { sanitizeRichTextHtml } from "@/lib/util.rich-text";

import { RichTextHtml, type RichTextHtmlProps } from "./rich-text-html";

interface RichTextProps extends Omit<RichTextHtmlProps, "safeHtml"> {
  /** Raw editor HTML straight from the store or product row. */
  html: string | null | undefined;
}

/**
 * Sanitises editor HTML, then renders it: a server component, the only
 * place the storefront may sanitise for `dangerouslySetInnerHTML`. A client
 * component takes HTML its server parent sanitised (`RichTextHtml`).
 */
export const RichText = ({ html, ...props }: RichTextProps) => (
  <RichTextHtml safeHtml={sanitizeRichTextHtml(html)} {...props} />
);
