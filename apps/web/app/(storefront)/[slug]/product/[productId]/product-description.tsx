import { useTranslations } from "next-intl";

import { RichText } from "@/components/storefront/ui/rich-text";
import { SectionHeader } from "@/components/storefront/ui/section-header";

import { hasRichTextContent } from "@/lib/util.rich-text";

interface ProductDescriptionProps {
  html: string | null;
  className?: string;
}

/** The product's editor text, rendered once for every screen size. */
export const ProductDescription = ({ html, className }: ProductDescriptionProps) => {
  const t = useTranslations("storefront.product");

  if (!hasRichTextContent(html)) {
    return null;
  }

  return (
    <section aria-labelledby="product-description" className={className}>
      <SectionHeader
        id="product-description"
        level="h2"
        title={t("description")}
        className="mb-3"
      />
      <RichText
        html={html}
        size="base"
        className="leading-relaxed sm:leading-relaxed prose-p:my-2 prose-ul:my-2 prose-ol:my-2 prose-li:my-0.5 prose-li:leading-relaxed [&_li>p]:my-0 [&>:first-child]:mt-0"
      />
    </section>
  );
};
