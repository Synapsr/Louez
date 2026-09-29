import { ProductInventorySectionView, type ProductInventorySectionProps } from './product-inventory-section-view';

export const ProductInventorySection = ({
  productId,
  inventoryDetail,
  stockKind,
}: ProductInventorySectionProps) => (
  <ProductInventorySectionView
    productId={productId}
    inventoryDetail={inventoryDetail}
    stockKind={stockKind}
  />
);
