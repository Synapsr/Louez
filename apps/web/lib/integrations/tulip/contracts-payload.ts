import type {
  ResolvedTulipItemInput,
  TulipContractPayload,
  TulipContractType,
  TulipContractUpdatePayload,
  TulipCustomerInput,
} from './contracts-types';

const IS_TULIP_TEST_CONTRACT = process.env.NODE_ENV !== 'production';

function addDays(baseDate: Date, days: number): Date {
  const date = new Date(baseDate);
  date.setDate(date.getDate() + days);
  return date;
}

function addMonths(baseDate: Date, months: number): Date {
  const date = new Date(baseDate);
  date.setMonth(date.getMonth() + months);
  return date;
}

export function resolveTulipContractTypeFromDates(
  startDate: Date,
  endDate: Date,
): TulipContractType {
  if (endDate >= addMonths(startDate, 12)) {
    return 'LLD';
  }

  if (endDate >= addDays(startDate, 30)) {
    return 'LMD';
  }

  return 'LCD';
}

function requiresContractIdentityOption(contractType: TulipContractType): boolean {
  return contractType === 'LMD' || contractType === 'LLD';
}

function assertRequiredIdentityFields(
  customer: TulipCustomerInput,
  contractType: TulipContractType,
) {
  if (!requiresContractIdentityOption(contractType)) {
    return;
  }

  const address = customer.address.trim();
  const city = customer.city.trim();
  const postalCode = customer.postalCode.trim();
  const country = (customer.country || 'FR').trim();
  const hasAddress = Boolean(address) && Boolean(city) && Boolean(postalCode);
  const hasCountry = Boolean(country);

  if (!hasAddress || !hasCountry) {
    throw new Error('errors.tulipCustomerDataIncomplete');
  }

  const companyName = customer.companyName?.trim();
  if (customer.customerType === 'business' && companyName) {
    return;
  }

  const firstName = customer.firstName.trim();
  const lastName = customer.lastName.trim();
  const phone = customer.phone.trim();
  if (!firstName || !lastName || !phone) {
    throw new Error('errors.tulipCustomerDataIncomplete');
  }
}

function buildCustomerPayload(
  customer: TulipCustomerInput,
  contractType: TulipContractType,
): {
  options: string[];
  company?: Record<string, unknown>;
  individual?: Record<string, unknown>;
} {
  const requireIdentityOption = requiresContractIdentityOption(contractType);
  assertRequiredIdentityFields(customer, contractType);

  const options = ['break', 'theft'];
  const companyName = customer.companyName?.trim() || '';
  const firstName = customer.firstName.trim();
  const lastName = customer.lastName.trim();
  const email = customer.email.trim();
  const phone = customer.phone.trim();
  const address = customer.address.trim();
  const city = customer.city.trim();
  const postalCode = customer.postalCode.trim();
  const country = (customer.country || 'FR').trim();
  const baseAddress = {
    ...(address ? { address } : {}),
    ...(city ? { city } : {}),
    ...(postalCode ? { zipcode: postalCode } : {}),
    ...(country ? { country } : {}),
  };

  if (customer.customerType === 'business' && companyName) {
    if (requireIdentityOption) {
      options.push('company');
    }

    return {
      options,
      company: {
        ...baseAddress,
        company_name: companyName,
        ...(firstName ? { first_name: firstName } : {}),
        ...(lastName ? { last_name: lastName } : {}),
      },
    };
  }

  if (requireIdentityOption) {
    options.push('individual');
  }

  return {
    options,
    individual: {
      ...baseAddress,
      ...(firstName ? { first_name: firstName } : {}),
      ...(lastName ? { last_name: lastName } : {}),
      ...(phone ? { phone_number: phone } : {}),
      ...(email ? { email } : {}),
    },
  };
}

function buildProductPayload(
  items: ResolvedTulipItemInput[],
  userName: string,
): Array<Record<string, unknown>> {
  const productsPayload: Array<Record<string, unknown>> = [];
  const productOccurrenceById = new Map<string, number>();

  for (const item of items) {
    let remainingQuantity = item.quantity;
    while (remainingQuantity > 0) {
      const nextOccurrence = (productOccurrenceById.get(item.productId) ?? 0) + 1;
      productOccurrenceById.set(item.productId, nextOccurrence);

      const serialLikeIdentifier = `${item.productId}-${nextOccurrence}`.trim();
      const safeProductMarked =
        serialLikeIdentifier.length > 0
          ? serialLikeIdentifier
          : `product-${productsPayload.length + 1}`;

      productsPayload.push({
        product_id: item.tulipProductId,
        data: {
          user_name: userName,
          product_marked: safeProductMarked,
          internal_id: safeProductMarked,
        },
      });

      remainingQuantity -= 1;
    }
  }

  return productsPayload;
}

export function buildContractPayload(params: {
  renterUid: string;
  contractType: TulipContractType;
  startDate: Date;
  endDate: Date;
  customer: TulipCustomerInput;
  insuredItems: ResolvedTulipItemInput[];
}): TulipContractPayload {
  const userName = `${params.customer.firstName} ${params.customer.lastName}`.trim();
  const productsPayload = buildProductPayload(params.insuredItems, userName);
  const customerPayload = buildCustomerPayload(params.customer, params.contractType);

  return {
    uid: params.renterUid,
    test: IS_TULIP_TEST_CONTRACT,
    start_date: params.startDate.toISOString(),
    end_date: params.endDate.toISOString(),
    contract_type: params.contractType,
    options: customerPayload.options,
    products: productsPayload,
    ...(customerPayload.company ? { company: customerPayload.company } : {}),
    ...(customerPayload.individual ? { individual: customerPayload.individual } : {}),
  };
}

export function toTulipContractUpdatePayload(
  payload: TulipContractPayload,
  mode:
    | 'full'
    | 'without_start_date'
    | 'without_start_date_and_identity'
    | 'end_date_and_products_only'
    | 'end_date_only' = 'full',
): TulipContractUpdatePayload {
  if (mode === 'end_date_only') {
    return {
      end_date: payload.end_date,
    };
  }

  if (mode === 'end_date_and_products_only') {
    return {
      end_date: payload.end_date,
      products: payload.products,
    };
  }

  if (mode === 'without_start_date_and_identity') {
    return {
      end_date: payload.end_date,
      contract_type: payload.contract_type,
      options: payload.options,
      products: payload.products,
    };
  }

  if (mode === 'without_start_date') {
    return {
      end_date: payload.end_date,
      contract_type: payload.contract_type,
      options: payload.options,
      products: payload.products,
      ...(payload.company ? { company: payload.company } : {}),
      ...(payload.individual ? { individual: payload.individual } : {}),
    };
  }

  return {
    start_date: payload.start_date,
    end_date: payload.end_date,
    contract_type: payload.contract_type,
    options: payload.options,
    products: payload.products,
    ...(payload.company ? { company: payload.company } : {}),
    ...(payload.individual ? { individual: payload.individual } : {}),
  };
}
