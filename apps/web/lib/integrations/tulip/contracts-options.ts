import { TulipApiError, tulipCreateContract, tulipUpdateContract } from './client';
import { getTulipErrorCode } from './contracts-errors';

function getOptionVariants(options: string[]): string[][] {
  const normalized = Array.from(new Set(options.map((option) => option.trim()).filter(Boolean)));
  if (normalized.length === 0) {
    return [[]];
  }

  const hasBreak = normalized.includes('break');
  const hasTheft = normalized.includes('theft');
  const identityOptions = normalized.filter(
    (option) => option !== 'break' && option !== 'theft',
  );

  const variants: string[][] = [normalized];
  if (hasBreak && hasTheft) {
    variants.push([...identityOptions, 'break']);
    variants.push([...identityOptions, 'theft']);
  }

  const seen = new Set<string>();
  return variants.filter((variant) => {
    const key = [...variant].sort().join('|');
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

export async function tulipCreateContractWithOptionsFallback(params: {
  apiKey: string;
  payload: Record<string, unknown>;
  preview: boolean;
  storeIdForLog?: string;
  reservationIdForLog?: string;
}) {
  const originalOptions = Array.isArray(params.payload.options)
    ? (params.payload.options as unknown[]).filter(
        (option): option is string => typeof option === 'string',
      )
    : [];

  const optionVariants = getOptionVariants(originalOptions);
  let lastError: unknown = null;

  for (let index = 0; index < optionVariants.length; index++) {
    const variant = optionVariants[index];

    try {
      return await tulipCreateContract(
        params.apiKey,
        {
          ...params.payload,
          options: variant,
        },
        params.preview,
      );
    } catch (error) {
      lastError = error;

      const isTulipApiError = error instanceof TulipApiError;
      const tulipErrorCode = isTulipApiError ? getTulipErrorCode(error.payload) : null;
      const canRetryWithAnotherVariant =
        isTulipApiError && tulipErrorCode === 1010 && index < optionVariants.length - 1;

      if (canRetryWithAnotherVariant) {
        console.warn('[tulip][contract-options] retrying with fallback options', {
          storeId: params.storeIdForLog,
          reservationId: params.reservationIdForLog,
          preview: params.preview,
          failedOptions: variant,
          nextOptions: optionVariants[index + 1],
          errorCode: tulipErrorCode,
          status: error.status,
        });
        continue;
      }

      throw error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error('errors.tulipQuoteFailed');
}

export async function tulipUpdateContractWithOptionsFallback(params: {
  apiKey: string;
  contractId: string;
  payload: Record<string, unknown>;
  preview: boolean;
  storeIdForLog?: string;
  reservationIdForLog?: string;
}) {
  const originalOptions = Array.isArray(params.payload.options)
    ? (params.payload.options as unknown[]).filter(
        (option): option is string => typeof option === 'string',
      )
    : [];

  const optionVariants = getOptionVariants(originalOptions);
  let lastError: unknown = null;

  for (let index = 0; index < optionVariants.length; index++) {
    const variant = optionVariants[index];

    try {
      return await tulipUpdateContract(
        params.apiKey,
        params.contractId,
        {
          ...params.payload,
          options: variant,
        },
        params.preview,
      );
    } catch (error) {
      lastError = error;

      const isTulipApiError = error instanceof TulipApiError;
      const tulipErrorCode = isTulipApiError ? getTulipErrorCode(error.payload) : null;
      const canRetryWithAnotherVariant =
        isTulipApiError && tulipErrorCode === 1010 && index < optionVariants.length - 1;

      if (canRetryWithAnotherVariant) {
        console.warn('[tulip][contract-options] retrying update with fallback options', {
          storeId: params.storeIdForLog,
          reservationId: params.reservationIdForLog,
          preview: params.preview,
          failedOptions: variant,
          nextOptions: optionVariants[index + 1],
          errorCode: tulipErrorCode,
          status: error.status,
        });
        continue;
      }

      throw error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error('errors.tulipContractUpdateFailed');
}
