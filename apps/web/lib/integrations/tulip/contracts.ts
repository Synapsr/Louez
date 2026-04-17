import { and, eq, isNull, ne, or } from 'drizzle-orm';

import { db, reservations } from '@louez/db';
import type { TulipPublicMode } from '@louez/types';

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
  ResolvedTulipItemInput,
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
  assignedUnits?: Array<{
    identifierSnapshot: string;
  }>;
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

function applyReservationUnitIdentifiersToCoverage(
  reservationItems: ReservationItemLike[],
  insuredItems: ResolvedTulipItemInput[],
): ResolvedTulipItemInput[] {
  if (insuredItems.length === 0) {
    return insuredItems;
  }

  const candidateItems = reservationItems
    .filter((item): item is ReservationItemLike & { productId: string } => {
      return Boolean(item.productId) && !item.isCustomItem;
    })
    .map((item) => ({
      productId: item.productId,
      quantity: item.quantity,
      productMarkedValues:
        item.assignedUnits
          ?.map((assignedUnit) => assignedUnit.identifierSnapshot.trim())
          .filter((identifier) => identifier.length > 0) ?? [],
    }));

  const insuredItemsWithProductMarkedValues: ResolvedTulipItemInput[] = [];
  let insuredIndex = 0;

  for (const candidateItem of candidateItems) {
    const insuredItem = insuredItems[insuredIndex];
    if (
      !insuredItem ||
      insuredItem.productId !== candidateItem.productId ||
      insuredItem.quantity !== candidateItem.quantity
    ) {
      continue;
    }

    insuredItemsWithProductMarkedValues.push({
      ...insuredItem,
      productMarkedValues: candidateItem.productMarkedValues,
    });
    insuredIndex += 1;
  }

  return insuredItemsWithProductMarkedValues;
}

export async function previewTulipQuoteForCheckout(params: {
  storeId: string;
  storeSettings: any;
  modeOverride?: TulipPublicMode;
  customer: TulipCustomerInput;
  items: TulipItemInput[];
  startDate: Date;
  endDate: Date;
  optIn: boolean | undefined;
}): Promise<TulipQuotePreviewResult> {
  const coverage = await resolveTulipCoverage(params.items);

  const tulipSettings = getTulipSettings(params.storeSettings);
  const effectiveMode = params.modeOverride ?? tulipSettings.publicMode;
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
    effectiveMode,
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

  if (params.startDate.getTime() < Date.now()) {
    throw new Error('errors.tulipContractPastDate');
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
      preview: true,
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
      items: {
        with: {
          assignedUnits: {
            columns: {
              identifierSnapshot: true,
            },
          },
        },
      },
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

  if (reservation.status !== 'confirmed' && reservation.status !== 'ongoing') {
    console.info('[tulip][contract-create] skipped: reservation not accepted yet', {
      reservationId: reservation.id,
      status: reservation.status,
      source: params.source,
    });
    return {
      contractId: null,
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

  if (reservation.startDate.getTime() < Date.now()) {
    await db
      .update(reservations)
      .set({
        tulipContractStatus: 'failed',
        updatedAt: new Date(),
      })
      .where(eq(reservations.id, reservation.id));

    throw new Error('errors.tulipContractPastDate');
  }

  const creationLockResult = await db
    .update(reservations)
    .set({
      tulipContractStatus: 'creating',
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(reservations.id, reservation.id),
        isNull(reservations.tulipContractId),
        or(
          isNull(reservations.tulipContractStatus),
          ne(reservations.tulipContractStatus, 'creating'),
        ),
      ),
    );

  if (creationLockResult[0]?.affectedRows === 0) {
    const lockedReservation = await db.query.reservations.findFirst({
      where: eq(reservations.id, reservation.id),
      columns: {
        tulipContractId: true,
        tulipContractStatus: true,
      },
    });

    if (lockedReservation?.tulipContractId) {
      console.info('[tulip][contract-create] skipped: contract already attached', {
        reservationId: reservation.id,
        contractId: lockedReservation.tulipContractId,
      });
      return {
        contractId: lockedReservation.tulipContractId,
        created: false,
      };
    }

    console.info('[tulip][contract-create] skipped: creation already in progress', {
      reservationId: reservation.id,
      status: lockedReservation?.tulipContractStatus ?? null,
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
  const insuredItems = applyReservationUnitIdentifiersToCoverage(
    reservation.items,
    coverage.insuredItems,
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
    insuredItems,
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
    await db
      .update(reservations)
      .set({
        tulipContractStatus: reservation.tulipContractStatus ?? null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(reservations.id, reservation.id),
          isNull(reservations.tulipContractId),
          eq(reservations.tulipContractStatus, 'creating'),
        ),
      );
    throw toTulipContractError(error, 'errors.tulipContractCreationFailed');
  }

  if (!contractId) {
    await db
      .update(reservations)
      .set({
        tulipContractStatus: reservation.tulipContractStatus ?? null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(reservations.id, reservation.id),
          isNull(reservations.tulipContractId),
          eq(reservations.tulipContractStatus, 'creating'),
        ),
      );
    throw new Error('errors.tulipInvalidContractResponse');
  }

  const attachResult = await db
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
        eq(reservations.tulipContractStatus, 'creating'),
      ),
    );

  if (attachResult[0]?.affectedRows === 0) {
    const attachedReservation = await db.query.reservations.findFirst({
      where: eq(reservations.id, reservation.id),
      columns: {
        tulipContractId: true,
      },
    });

    if (attachedReservation?.tulipContractId) {
      return {
        contractId: attachedReservation.tulipContractId,
        created: false,
      };
    }

    throw new Error('errors.tulipContractCreationFailed');
  }

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
      items: {
        with: {
          assignedUnits: {
            columns: {
              identifierSnapshot: true,
            },
          },
        },
      },
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
  const insuredItems = applyReservationUnitIdentifiersToCoverage(
    reservation.items,
    coverage.insuredItems,
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
    insuredItems,
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
