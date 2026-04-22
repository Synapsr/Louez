import { TulipApiError } from './client';

function getTulipEnvelope(payload: unknown): Record<string, unknown> | null {
  const source = Array.isArray(payload) ? payload[0] : payload;
  if (!source || typeof source !== 'object') {
    return null;
  }

  return source as Record<string, unknown>;
}

export function getTulipErrorCode(payload: unknown): number | null {
  const envelope = getTulipEnvelope(payload);
  if (!envelope) {
    return null;
  }

  const nestedError = envelope.error;
  if (!nestedError || typeof nestedError !== 'object') {
    return null;
  }

  const code = (nestedError as { code?: unknown }).code;
  return typeof code === 'number' ? code : null;
}

export function getTulipErrorMessage(payload: unknown): string | null {
  const envelope = getTulipEnvelope(payload);
  if (!envelope) {
    return null;
  }

  const nestedError = envelope.error;
  if (nestedError && typeof nestedError === 'object') {
    const message = (nestedError as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim().length > 0) {
      return message.trim();
    }
  }

  const message = envelope.message;
  if (typeof message === 'string' && message.trim().length > 0) {
    return message.trim();
  }

  return null;
}

export function getTulipExecutionId(payload: unknown): string | null {
  const envelope = getTulipEnvelope(payload);
  if (!envelope) {
    return null;
  }

  const executionId = envelope.execution_id;
  return typeof executionId === 'string' && executionId.trim().length > 0
    ? executionId.trim()
    : null;
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
          hasLouezProductId:
            typeof firstProductData?.louez_product_ID === 'string' &&
            firstProductData.louez_product_ID.trim().length > 0,
        }
      : null,
  };
}

export function toTulipContractError(error: unknown, fallbackKey: string): Error {
  if (error instanceof Error && error.message.startsWith('errors.')) {
    return error;
  }

  if (error instanceof TulipApiError) {
    const code = getTulipErrorCode(error.payload);
    const rawPayloadMessage = getTulipErrorMessage(error.payload)?.trim() ?? '';
    const payloadMessage = rawPayloadMessage.toLowerCase();
    const payload = JSON.stringify(error.payload ?? {}).toLowerCase();
    const message = `${error.message} ${payloadMessage} ${payload}`.toLowerCase();

    switch (code) {
      case 1000:
      case 1021:
        return new Error('errors.tulipContractPastDate');
      case 1001:
      case 1002:
        return new Error('errors.tulipContractDatesInvalid');
      case 1003:
      case 1202:
        return new Error(
          rawPayloadMessage || 'errors.tulipContractActionForbidden',
        );
      case 1010:
        return new Error('errors.tulipContractOptionsInvalid');
      case 1013:
      case 1014:
      case 1100:
      case 1101:
      case 1102:
      case 1103:
      case 1104:
      case 1105:
      case 1106:
      case 1107:
      case 1108:
      case 1109:
        return new Error('errors.tulipCustomerDataIncomplete');
      case 1050:
        return new Error('errors.tulipContractUpdateWindowExpired');
      case 1051:
        return new Error('errors.tulipContractNotFound');
      case 1052:
        return new Error('errors.tulipContractNotOpen');
      case 1150:
      case 1151:
        return new Error('errors.tulipContractIdentityFrozen');
      case 1200:
      case 1201:
      case 1220:
      case 1221:
      case 1222:
      case 1223:
      case 1224:
      case 1225:
      case 1226:
      case 1227:
      case 1228:
      case 1229:
      case 1230:
        return new Error('errors.tulipContractPayloadInvalid');
      case 1301:
      case 1311:
      case 1321:
      case 1334:
      case 1335:
        return new Error('errors.tulipContractProductMarkedMissing');
    }

    if (message.includes('past') || message.includes('retro') || message.includes('date')) {
      return new Error('errors.tulipContractPastDate');
    }

    if (message.includes('product_marked')) {
      return new Error('errors.tulipContractProductMarkedMissing');
    }

    if (
      error.status === 403 ||
      message.includes('forbidden') ||
      message.includes('not allowed') ||
      message.includes('permission')
    ) {
      return new Error(
        rawPayloadMessage || 'errors.tulipContractActionForbidden',
      );
    }

    if (error.status === 401) {
      return new Error('errors.tulipApiKeyInvalid');
    }

    if (error.status === 400) {
      return new Error(
        rawPayloadMessage || 'errors.tulipContractValidationFailed',
      );
    }

    if (error.status >= 500) {
      return new Error('errors.tulipApiUnavailable');
    }

    return new Error(fallbackKey);
  }

  return new Error(fallbackKey);
}
