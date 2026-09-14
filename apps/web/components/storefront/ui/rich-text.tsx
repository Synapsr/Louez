import { cn } from "@louez/utils";

import { hasRichTextContent, sanitizeRichTextHtml } from "@/lib/util.rich-text";

type RichTextSize = "sm" | "base" | "lg";

const SIZE_CLASS_NAME: Record<RichTextSize, string> = {
  sm: "prose-sm",
  base: "prose-sm sm:prose-base",
  lg: "prose-base sm:prose-lg",
};

interface RichTextProps {
  /** Raw editor HTML straight from the store or product row. */
  html: string | null | undefined;
  /** `sm` for a summary card or accordion body, `base` for a full page, `lg` under a hero title. */
  size?: RichTextSize;
  className?: string;
}

/**
 * Renders editor HTML once it has been sanitised — the only place the
 * storefront may use `dangerouslySetInnerHTML`. Returns nothing for an
 * empty editor (`<p></p>`), so callers do not have to check first.
 */
export const RichText = ({ html, size = "base", className }: RichTextProps) => {
  if (!hasRichTextContent(html)) {
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
      dangerouslySetInnerHTML={{ __html: sanitizeRichTextHtml(html) }}
    />
  );
};
