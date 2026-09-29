import { ProductStatsSectionView, type ProductStatsSectionProps } from './product-stats-section-view';

export const ProductStatsSection = ({
  revenueStats,
  reservationCounts,
  utilization,
  inventoryDetail,
  stockKind,
  currency,
}: ProductStatsSectionProps) => (
  <ProductStatsSectionView
    revenueStats={revenueStats}
    reservationCounts={reservationCounts}
    utilization={utilization}
    inventoryDetail={inventoryDetail}
    stockKind={stockKind}
    currency={currency}
  />
);
