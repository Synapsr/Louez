import { and, eq, isNull } from 'drizzle-orm';

import { db, reservations } from '@louez/db';

import { TulipApiError, tulipCancelContract } from './client';
import {
  getTulipCoverageSummary,
  resolveTulipCoverage,
} from './contracts-coverage';
import {
  summarizeContractPayloadForLogs,
  toTulipContractError,
} from './contracts-errors';
import { getReservationInsuranceSelection } from './contracts-insurance';
import {
  tulipCreateContractWithOptionsFallback,
  tulipUpdateContractWithOptionsFallback,
} from './contracts-options';
import {
  buildContractPayload,
  resolveTulipContractTypeFromDates,
  toTulipContractUpdatePayload,
} from './contracts-payload';
import { assertTulipContractTypeEnabled } from './contracts-renter';
import type {
  TulipContractUpdatePayload,
  TulipCustomerInput,
  TulipItemInput,
  TulipQuotePreviewResult,
} from './contracts-types';
import {
  getTulipApiKey,
  getTulipRenterUidForContracts,
  getTulipSettings,
  shouldApplyTulipInsurance,
} from './settings';

export { getTulipCoverageSummary };
export type { TulipCoverageSummary, TulipQuotePreviewResult } from './contracts-types';

type ReservationCustomerLike = {
  customerType?: 'individual' | 'business' | null;
  companyName?: string | null;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
  address: string | null;
  city: string | null;
  postalCode: string | null;
  country?: string | null;
};

type ReservationItemLike = {
  productId: string | null;
  isCustomItem: boolean;
  quantity: number;
};

const dashboardTulipContractCreationSources = [
  'dashboard_reservation_confirmation',
  'dashboard_manual_reservation_creation',
  'dashboard_reservation_sync_missing_contract',
] as const;

type TulipContractCreationSource =
  (typeof dashboardTulipContractCreationSources)[number];

function assertDashboardTulipContractCreationSource(source: string) {
  if (
    !dashboardTulipContractCreationSources.includes(
      source as TulipContractCreationSource,
    )
  ) {
    console.warn('[tulip][contract-create] blocked non-dashboard source', {
      source,
    });
    throw new Error('errors.forbidden');
  }
}

function toTulipCustomerInput(customer: ReservationCustomerLike): TulipCustomerInput {
  return {
    customerType: customer.customerType,
    companyName: customer.companyName,
    firstName: customer.firstName,
    lastName: customer.lastName,
    email: customer.email,
    phone: customer.phone || '',
    address: customer.address || '',
    city: customer.city || '',
    postalCode: customer.postalCode || '',
    country: customer.country,
  };
}

function toInsuranceCandidateItems(items: ReservationItemLike[]): TulipItemInput[] {
  return items
    .filter((item) => item.productId && !item.isCustomItem)
    .map((item) => ({
      productId: item.productId!,
      quantity: item.quantity,
    }));
}

export async function previewTulipQuoteForCheckout(params: {
  storeId: string;
  storeSettings: any;
  customer: TulipCustomerInput;
  items: TulipItemInput[];
  startDate: Date;
  endDate: Date;
  optIn: boolean | undefined;
}): Promise<TulipQuotePreviewResult> {
  const coverage = await resolveTulipCoverage(params.items);

  const tulipSettings = getTulipSettings(params.storeSettings);
  if (!tulipSettings.enabled) {
    return {
      shouldApply: false as const,
      amount: 0,
      inclusionEnabled: false,
      insuredProductCount: coverage.insuredProductCount,
      uninsuredProductCount: coverage.uninsuredProductCount,
      insuredProductIds: coverage.insuredProductIds,
    };
  }

  const shouldApply = shouldApplyTulipInsurance(
    tulipSettings.publicMode,
    params.optIn,
  );

  if (!shouldApply || coverage.insuredProductCount === 0) {
    return {
      shouldApply: false as const,
      amount: 0,
      inclusionEnabled: false,
      insuredProductCount: coverage.insuredProductCount,
      uninsuredProductCount: coverage.uninsuredProductCount,
      insuredProductIds: coverage.insuredProductIds,
    };
  }

  const apiKey = getTulipApiKey(params.storeSettings);
  if (!apiKey || !tulipSettings.renterUid) {
    throw new Error('errors.tulipNotConfigured');
  }

  const resolvedContractType = resolveTulipContractTypeFromDates(
    params.startDate,
    params.endDate,
  );

  const renter = await assertTulipContractTypeEnabled({
    apiKey,
    renterUid: tulipSettings.renterUid,
    contractType: resolvedContractType,
    fallbackKey: 'errors.tulipQuoteFailed',
  });

  const payload = buildContractPayload({
    renterUid: tulipSettings.renterUid,
    contractType: resolvedContractType,
    startDate: params.startDate,
    endDate: params.endDate,
    customer: params.customer,
    insuredItems: coverage.insuredItems,
  });

  try {
    const contract = await tulipCreateContractWithOptionsFallback({
      apiKey,
      payload,
      preview: false,
      storeIdForLog: params.storeId,
    });

    return {
      shouldApply: true as const,
      amount: Number(contract.price || 0),
      inclusionEnabled: renter?.options?.inclusion === true,
      insuredProductCount: coverage.insuredProductCount,
      uninsuredProductCount: coverage.uninsuredProductCount,
      insuredProductIds: coverage.insuredProductIds,
    };
  } catch (error) {
    if (error instanceof TulipApiError) {
      console.error('[tulip][checkout-quote] tulip API rejected quote request', {
        storeId: params.storeId,
        status: error.status,
        message: error.message,
        request: summarizeContractPayloadForLogs(payload),
        payload: error.payload,
      });
    } else {
      console.error('[tulip][checkout-quote] unexpected quote error', {
        storeId: params.storeId,
        error: error instanceof Error ? error.message : 'unknown',
      });
    }

    throw toTulipContractError(error, 'errors.tulipQuoteFailed');
  }
}

export async function createTulipContractForReservation(params: {
  reservationId: string;
  source: TulipContractCreationSource;
  force?: boolean;
}) {
  assertDashboardTulipContractCreationSource(params.source);

  const reservation = await db.query.reservations.findFirst({
    where: eq(reservations.id, params.reservationId),
    with: {
      store: true,
      customer: true,
      items: true,
    },
  });

  if (!reservation) {
    throw new Error('errors.reservationNotFound');
  }

  console.info('[tulip][contract-create] start', {
    reservationId: reservation.id,
    storeId: reservation.storeId,
    source: params.source,
    currentStatus: reservation.tulipContractStatus,
    hasContractId: Boolean(reservation.tulipContractId),
  });

  if (reservation.tulipContractId && !params.force) {
    console.info('[tulip][contract-create] skipped: already created', {
      reservationId: reservation.id,
      contractId: reservation.tulipContractId,
    });
    return {
      contractId: reservation.tulipContractId,
      created: false,
    };
  }

  if (reservation.tulipContractStatus === 'not_required' && !params.force) {
    console.info('[tulip][contract-create] skipped: not required', {
      reservationId: reservation.id,
    });
    return {
      contractId: null,
      created: false,
    };
  }

  const insuranceSelection = getReservationInsuranceSelection({
    tulipInsuranceOptIn: reservation.tulipInsuranceOptIn,
    tulipInsuranceAmount: reservation.tulipInsuranceAmount,
    items: reservation.items,
  });

  if (!insuranceSelection.optIn) {
    console.info('[tulip][contract-create] marked not required: opt-in disabled', {
      reservationId: reservation.id,
      optIn: insuranceSelection.optIn,
      amount: insuranceSelection.amount,
    });
    await db
      .update(reservations)
      .set({
        tulipContractStatus: 'not_required',
        updatedAt: new Date(),
      })
      .where(eq(reservations.id, reservation.id));

    return {
      contractId: null,
      created: false,
    };
  }

  const storeSettings = reservation.store.settings as any;
  const tulipSettings = getTulipSettings(storeSettings);

  if (!tulipSettings.enabled) {
    await db
      .update(reservations)
      .set({
        tulipContractStatus: 'not_required',
        updatedAt: new Date(),
      })
      .where(eq(reservations.id, reservation.id));

    return {
      contractId: null,
      created: false,
    };
  }

  const apiKey = getTulipApiKey(storeSettings);
  if (!apiKey || !tulipSettings.renterUid) {
    throw new Error('errors.tulipNotConfigured');
  }

  const resolvedContractType = resolveTulipContractTypeFromDates(
    reservation.startDate,
    reservation.endDate,
  );

  await assertTulipContractTypeEnabled({
    apiKey,
    renterUid: tulipSettings.renterUid,
    contractType: resolvedContractType,
    fallbackKey: 'errors.tulipContractCreationFailed',
  });

  const coverage = await resolveTulipCoverage(
    toInsuranceCandidateItems(reservation.items),
  );

  console.info('[tulip][contract-create] coverage resolved', {
    reservationId: reservation.id,
    insuredProductCount: coverage.insuredProductCount,
    uninsuredProductCount: coverage.uninsuredProductCount,
  });

  if (coverage.insuredProductCount === 0) {
    console.info(
      '[tulip][contract-create] marked not required: no insurable mapped products',
      {
        reservationId: reservation.id,
      },
    );
    await db
      .update(reservations)
      .set({
        tulipContractStatus: 'not_required',
        updatedAt: new Date(),
      })
      .where(eq(reservations.id, reservation.id));

    return {
      contractId: null,
      created: false,
    };
  }

  const payload = buildContractPayload({
    renterUid: tulipSettings.renterUid,
    contractType: resolvedContractType,
    startDate: reservation.startDate,
    endDate: reservation.endDate,
    customer: toTulipCustomerInput(reservation.customer),
    insuredItems: coverage.insuredItems,
  });

  let contractId: string | null = null;
  try {
    const contract = await tulipCreateContractWithOptionsFallback({
      apiKey,
      payload,
      preview: false,
      storeIdForLog: reservation.storeId,
      reservationIdForLog: reservation.id,
    });
    contractId = contract.cid || null;
  } catch (error) {
    console.error('[tulip][contract-create] api failure', {
      reservationId: reservation.id,
      request: summarizeContractPayloadForLogs(payload),
      error: error instanceof Error ? error.message : 'unknown',
    });
    throw toTulipContractError(error, 'errors.tulipContractCreationFailed');
  }

  if (!contractId) {
    throw new Error('errors.tulipInvalidContractResponse');
  }

  await db
    .update(reservations)
    .set({
      tulipContractId: contractId,
      tulipContractStatus: 'created',
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(reservations.id, reservation.id),
        isNull(reservations.tulipContractId),
      ),
    );

  console.info('[tulip][contract-create] success', {
    reservationId: reservation.id,
    contractId,
  });

  return {
    contractId,
    created: true,
  };
}

export async function syncTulipContractForReservation(params: {
  reservationId: string;
}) {
  const reservation = await db.query.reservations.findFirst({
    where: eq(reservations.id, params.reservationId),
    with: {
      store: true,
      customer: true,
      items: true,
    },
  });

  if (!reservation) {
    throw new Error('errors.reservationNotFound');
  }

  if (reservation.status !== 'confirmed' && reservation.status !== 'ongoing') {
    return {
      synced: false,
      action: 'skipped_status' as const,
    };
  }

  if (!reservation.tulipContractId) {
    const createdResult = await createTulipContractForReservation({
      reservationId: reservation.id,
      source: 'dashboard_reservation_sync_missing_contract',
      force: true,
    });

    return {
      synced: true,
      action: createdResult.created ? ('created' as const) : ('not_required' as const),
      contractId: createdResult.contractId,
    };
  }

  const storeSettings = reservation.store.settings as any;
  const tulipSettings = getTulipSettings(storeSettings);
  const apiKey = getTulipApiKey(storeSettings);
  if (!apiKey) {
    throw new Error('errors.tulipNotConfigured');
  }

  const contractId = reservation.tulipContractId;
  const insuranceSelection = getReservationInsuranceSelection({
    tulipInsuranceOptIn: reservation.tulipInsuranceOptIn,
    tulipInsuranceAmount: reservation.tulipInsuranceAmount,
    items: reservation.items,
  });

  if (!insuranceSelection.optIn || !tulipSettings.enabled) {
    await tulipCancelContract(apiKey, contractId, {}, false);
    await db
      .update(reservations)
      .set({
        tulipContractId: null,
        tulipContractStatus: 'not_required',
        updatedAt: new Date(),
      })
      .where(eq(reservations.id, reservation.id));

    return {
      synced: true,
      action: 'cancelled' as const,
      contractId: null,
    };
  }

  const renterUid = getTulipRenterUidForContracts(storeSettings);
  if (!renterUid) {
    throw new Error('errors.tulipNotConfigured');
  }

  const resolvedContractType = resolveTulipContractTypeFromDates(
    reservation.startDate,
    reservation.endDate,
  );

  await assertTulipContractTypeEnabled({
    apiKey,
    renterUid,
    contractType: resolvedContractType,
    fallbackKey: 'errors.tulipContractUpdateFailed',
  });

  const coverage = await resolveTulipCoverage(
    toInsuranceCandidateItems(reservation.items),
  );

  if (coverage.insuredProductCount === 0) {
    await tulipCancelContract(apiKey, contractId, {}, false);
    await db
      .update(reservations)
      .set({
        tulipContractId: null,
        tulipContractStatus: 'not_required',
        updatedAt: new Date(),
      })
      .where(eq(reservations.id, reservation.id));

    return {
      synced: true,
      action: 'cancelled' as const,
      contractId: null,
    };
  }

  const createPayload = buildContractPayload({
    renterUid,
    contractType: resolvedContractType,
    startDate: reservation.startDate,
    endDate: reservation.endDate,
    customer: toTulipCustomerInput(reservation.customer),
    insuredItems: coverage.insuredItems,
  });
  const updatePayloadAttempts: Array<{
    label: string;
    payload: TulipContractUpdatePayload;
  }> = [
    {
      label: 'full',
      payload: toTulipContractUpdatePayload(createPayload, 'full'),
    },
    {
      label: 'without_start_date',
      payload: toTulipContractUpdatePayload(createPayload, 'without_start_date'),
    },
    {
      label: 'without_start_date_and_identity',
      payload: toTulipContractUpdatePayload(
        createPayload,
        'without_start_date_and_identity',
      ),
    },
    {
      label: 'end_date_and_products_only',
      payload: toTulipContractUpdatePayload(
        createPayload,
        'end_date_and_products_only',
      ),
    },
    {
      label: 'end_date_only',
      payload: toTulipContractUpdatePayload(createPayload, 'end_date_only'),
    },
  ];

  let updateError: unknown = null;
  let updated = false;

  for (let index = 0; index < updatePayloadAttempts.length; index++) {
    const attempt = updatePayloadAttempts[index];
    try {
      await tulipUpdateContractWithOptionsFallback({
        apiKey,
        contractId,
        payload: attempt.payload,
        preview: false,
        storeIdForLog: reservation.storeId,
        reservationIdForLog: reservation.id,
      });

      if (index > 0) {
        console.info('[tulip][contract-sync] update recovered with fallback payload', {
          reservationId: reservation.id,
          contractId,
          fallback: attempt.label,
          attempts: index + 1,
        });
      }

      updated = true;
      break;
    } catch (error) {
      updateError = error;
      const hasNextAttempt = index < updatePayloadAttempts.length - 1;
      if (!hasNextAttempt) {
        break;
      }

      console.info('[tulip][contract-sync] update retry with reduced payload', {
        reservationId: reservation.id,
        contractId,
        failedAttempt: attempt.label,
        nextAttempt: updatePayloadAttempts[index + 1].label,
        error: error instanceof Error ? error.message : 'unknown',
      });
    }
  }

  if (!updated) {
    console.warn('[tulip][contract-sync] update failed, keeping current contract', {
      reservationId: reservation.id,
      contractId,
      error: updateError instanceof Error ? updateError.message : 'unknown',
    });
    throw toTulipContractError(updateError, 'errors.tulipContractUpdateFailed');
  }

  await db
    .update(reservations)
    .set({
      tulipContractStatus: 'updated',
      updatedAt: new Date(),
    })
    .where(eq(reservations.id, reservation.id));

  return {
    synced: true,
    action: 'updated' as const,
    contractId,
  };
}

export async function cancelTulipContractForReservation(params: {
  reservationId: string;
}) {
  const reservation = await db.query.reservations.findFirst({
    where: eq(reservations.id, params.reservationId),
    with: {
      store: true,
    },
  });

  if (!reservation) {
    throw new Error('errors.reservationNotFound');
  }

  if (!reservation.tulipContractId) {
    return {
      cancelled: false,
    };
  }

  const storeSettings = reservation.store.settings as any;
  const apiKey = getTulipApiKey(storeSettings);
  if (!apiKey) {
    throw new Error('errors.tulipNotConfigured');
  }

  await tulipCancelContract(apiKey, reservation.tulipContractId, {}, false);

  await db
    .update(reservations)
    .set({
      tulipContractId: null,
      tulipContractStatus: 'cancelled',
      updatedAt: new Date(),
    })
    .where(eq(reservations.id, reservation.id));

  return {
    cancelled: true,
  };
}
