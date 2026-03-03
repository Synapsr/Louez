export type TulipCustomerInput = {
  customerType?: 'individual' | 'business' | null;
  companyName?: string | null;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  postalCode: string;
  country?: string | null;
};

export type TulipItemInput = {
  productId: string;
  quantity: number;
};

export type TulipContractType = 'LCD' | 'LMD' | 'LLD';

export type ResolvedTulipItemInput = {
  productId: string;
  tulipProductId: string;
  quantity: number;
};

export type TulipCoverageSummary = {
  insuredProductCount: number;
  uninsuredProductCount: number;
  insuredProductIds: string[];
};

export type TulipCoverageResolution = {
  insuredItems: ResolvedTulipItemInput[];
} & TulipCoverageSummary;

export type TulipQuotePreviewResult = {
  shouldApply: boolean;
  amount: number;
  inclusionEnabled: boolean;
  insuredProductCount: number;
  uninsuredProductCount: number;
  insuredProductIds: string[];
};

export type TulipContractPayload = {
  uid: string;
  test: boolean;
  start_date: string;
  end_date: string;
  contract_type: TulipContractType;
  options: string[];
  products: Array<Record<string, unknown>>;
  company?: Record<string, unknown>;
  individual?: Record<string, unknown>;
};

export type TulipContractUpdatePayload = {
  start_date?: string;
  end_date?: string;
  contract_type?: TulipContractType;
  options?: string[];
  products?: Array<Record<string, unknown>>;
  company?: Record<string, unknown>;
  individual?: Record<string, unknown>;
};
