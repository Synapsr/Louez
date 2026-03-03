import { TulipApiError } from './client';

export function getTulipErrorCode(payload: unknown): number | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const nestedError = (payload as { error?: unknown }).error;
  if (!nestedError || typeof nestedError !== 'object') {
    return null;
  }

  const code = (nestedError as { code?: unknown }).code;
  return typeof code === 'number' ? code : null;
}

export function summarizeContractPayloadForLogs(payload: Record<string, unknown>) {
  const products = Array.isArray(payload.products) ? payload.products : [];

  let missingProductMarkedCount = 0;
  let missingUserNameCount = 0;

  for (const product of products) {
    if (!product || typeof product !== 'object') {
      missingProductMarkedCount++;
      missingUserNameCount++;
      continue;
    }

    const productObj = product as {
      product_id?: unknown;
      data?: unknown;
    };
    const dataObj =
      productObj.data && typeof productObj.data === 'object'
        ? (productObj.data as Record<string, unknown>)
        : null;

    const productMarked = dataObj?.product_marked;
    if (typeof productMarked !== 'string' || productMarked.trim().length === 0) {
      missingProductMarkedCount++;
    }

    const userName = dataObj?.user_name;
    if (typeof userName !== 'string' || userName.trim().length === 0) {
      missingUserNameCount++;
    }
  }

  const firstProduct =
    products.length > 0 && products[0] && typeof products[0] === 'object'
      ? (products[0] as {
          product_id?: unknown;
          data?: unknown;
        })
      : null;

  const firstProductData =
    firstProduct?.data && typeof firstProduct.data === 'object'
      ? (firstProduct.data as Record<string, unknown>)
      : null;

  return {
    contractType:
      typeof payload.contract_type === 'string' ? payload.contract_type : undefined,
    options: Array.isArray(payload.options)
      ? payload.options.filter((option): option is string => typeof option === 'string')
      : [],
    productsCount: products.length,
    missingProductMarkedCount,
    missingUserNameCount,
    sampleProduct: firstProduct
      ? {
          productId:
            typeof firstProduct.product_id === 'string'
              ? firstProduct.product_id
              : undefined,
          hasUserName:
            typeof firstProductData?.user_name === 'string' &&
            firstProductData.user_name.trim().length > 0,
          hasProductMarked:
            typeof firstProductData?.product_marked === 'string' &&
            firstProductData.product_marked.trim().length > 0,
          hasInternalId:
            typeof firstProductData?.internal_id === 'string' &&
            firstProductData.internal_id.trim().length > 0,
        }
      : null,
  };
}

export function toTulipContractError(error: unknown, fallbackKey: string): Error {
  if (error instanceof Error && error.message.startsWith('errors.')) {
    return error;
  }

  if (error instanceof TulipApiError) {
    const payload = JSON.stringify(error.payload ?? {}).toLowerCase();
    const message = `${error.message} ${payload}`.toLowerCase();

    if (message.includes('past') || message.includes('retro') || message.includes('date')) {
      return new Error('errors.tulipContractPastDate');
    }

    if (
      error.status === 403 ||
      message.includes('forbidden') ||
      message.includes('not allowed') ||
      message.includes('permission')
    ) {
      return new Error('errors.tulipContractActionForbidden');
    }

    if (error.status === 401) {
      return new Error('errors.tulipApiKeyInvalid');
    }

    if (error.status >= 500) {
      return new Error('errors.tulipApiUnavailable');
    }

    return new Error(fallbackKey);
  }

  return new Error(fallbackKey);
}
