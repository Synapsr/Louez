import { sanitizeProductDescriptionHtml } from "@/lib/util.product-description";

import { ProductInfoSectionView, type ProductInfoSectionProps } from "./product-info-section-view";

type ProductInfoSectionServerProps = Omit<ProductInfoSectionProps, "product"> & {
  product: Omit<ProductInfoSectionProps["product"], "descriptionHtml"> & {
    description: string | null;
  };
};

/** The product's info card; its description is sanitised here, on the server. */
export const ProductInfoSection = ({
  product: { description, ...product },
  currency,
  timezone,
}: ProductInfoSectionServerProps) => (
  <ProductInfoSectionView
    product={{
      ...product,
      descriptionHtml: description ? sanitizeProductDescriptionHtml(description) : null,
    }}
    currency={currency}
    timezone={timezone}
  />
);
