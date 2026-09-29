import { ProductInfoSectionView, type ProductInfoSectionProps } from "./product-info-section-view";

export const ProductInfoSection = ({
  product,
  currency,
  timezone,
}: ProductInfoSectionProps) => (
  <ProductInfoSectionView
    product={product}
    currency={currency}
    timezone={timezone}
  />
);
