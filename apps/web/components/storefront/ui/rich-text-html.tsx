import { cn } from "@louez/utils";

import { hasRichTextContent } from "@/lib/util.rich-text";

type RichTextSize = "sm" | "base" | "lg";

const SIZE_CLASS_NAME: Record<RichTextSize, string> = {
  sm: "prose-sm",
  base: "prose-sm sm:prose-base",
  lg: "prose-base sm:prose-lg",
};

export interface RichTextHtmlProps {
  /** Editor HTML already sanitised on the server (`RichText`, or the page that passes it). */
  safeHtml: string | null | undefined;
  /** `sm` for a summary card or accordion body, `base` for a full page, `lg` under a hero title. */
  size?: RichTextSize;
  className?: string;
}

/**
 * Renders editor HTML that the server sanitised: safe to use in a client
 * component, which never carries the sanitiser. Returns nothing for an empty
 * editor (`<p></p>`), so callers do not have to check first.
 */
export const RichTextHtml = ({ safeHtml, size = "base", className }: RichTextHtmlProps) => {
  if (!safeHtml || !hasRichTextContent(safeHtml)) {
    return null;
  }

  return (
    <div
      className={cn(
        "prose max-w-none wrap-break-word dark:prose-invert",
        "prose-headings:font-semibold prose-headings:tracking-tight prose-headings:text-foreground prose-h1:text-2xl prose-h2:text-xl prose-h3:text-lg",
        "prose-p:text-muted-foreground prose-li:text-muted-foreground prose-a:text-foreground prose-a:underline prose-a:underline-offset-4 prose-strong:text-foreground",
        SIZE_CLASS_NAME[size],
        className,
      )}
      data-slot="rich-text"
      dangerouslySetInnerHTML={{ __html: safeHtml }}
    />
  );
};
