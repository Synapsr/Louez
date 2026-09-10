import { getTulipCoverageSummary } from "@/lib/integrations/tulip/contracts-coverage";
import { hasReservationInsuranceCoverage } from "@louez/utils";

interface InsuredProductsReservation {
  tulipContractId: string | null;
  tulipContractStatus: string | null;
  items: Array<{
    productId: string | null;
    quantity: number;
    isCustomItem: boolean;
    productSnapshot: unknown;
    totalPrice: string;
  }>;
}

/**
 * Coverage on the contract and customer account follows the reservation's
 * insurance contract, independently of the store's current public offer.
 */
export const getReservationInsuredProductIds = async (
  reservation: InsuredProductsReservation,
): Promise<Set<string>> => {
  if (!hasReservationInsuranceCoverage(reservation)) return new Set();

  const quoteItems = reservation.items.flatMap((item) =>
    item.productId && !item.isCustomItem
      ? [{ productId: item.productId, quantity: item.quantity }]
      : [],
  );
  if (quoteItems.length === 0) return new Set();

  const coverage = await getTulipCoverageSummary(quoteItems);
  return new Set(coverage.insuredProductIds);
};
