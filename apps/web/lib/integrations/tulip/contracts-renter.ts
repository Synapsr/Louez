import { TulipApiError, tulipGetRenter } from './client';
import { toTulipContractError } from './contracts-errors';
import type { TulipContractType } from './contracts-types';

export async function assertTulipContractTypeEnabled(params: {
  apiKey: string;
  renterUid: string;
  contractType: TulipContractType;
  fallbackKey: string;
}): Promise<Awaited<ReturnType<typeof tulipGetRenter>>> {
  let renter: Awaited<ReturnType<typeof tulipGetRenter>> = null;

  try {
    renter = await tulipGetRenter(params.apiKey, params.renterUid);
  } catch (error) {
    if (error instanceof TulipApiError && error.status === 404) {
      throw new Error('errors.tulipRenterNotFound');
    }
    throw toTulipContractError(error, params.fallbackKey);
  }

  if (!renter?.uid) {
    throw new Error('errors.tulipRenterNotFound');
  }

  const contractEnabled = renter.options?.[params.contractType] === true;
  if (!contractEnabled) {
    throw new Error('errors.tulipContractTypeDisabled');
  }

  return renter;
}
