export interface ProductPromotion {
  percentage: number;
  /** Inclusive calendar dates in the store's timezone; null means no limit. */
  startsOn: string | null;
  endsOn: string | null;
}

export interface AppliedProductPromotion {
  percentage: number;
  originalSubtotal: number;
  discountAmount: number;
}
