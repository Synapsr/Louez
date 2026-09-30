import { ProductQuickFactsView, type ProductQuickFactsProps } from './product-quick-facts-view';

export const ProductQuickFacts = ({
  product,
  currency,
}: ProductQuickFactsProps) => (
  <ProductQuickFactsView
    product={product}
    currency={currency}
  />
);
