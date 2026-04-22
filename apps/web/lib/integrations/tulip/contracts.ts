import { and, eq, isNull, ne, or } from 'drizzle-orm';

import { db, reservations } from '@louez/db';
import type { TulipPublicMode } from '@louez/types';

import {
  TulipApiError,
  tulipAddProductsToContract,
  tulipCancelContract,
  tulipDeleteProductsFromContract,
  tulipGetContract,
  tulipListProducts,
  tulipUpdateContract,
  type TulipContract,
  type TulipContractProduct,
} from './client';
import {
  getTulipCoverageSummary,
  resolveTulipCoverage,
} from './contracts-coverage';
import {
  summarizeContractPayloadForLogs,
  toTulipContractError,
} from './contracts-errors';
import { getReservationInsuranceSelection } from './contracts-insurance';
import { tulipCreateContractWithOptionsFallback } from './contracts-options';
import {
  buildContractPayload,
  resolveTulipContractTypeFromDates,
} from './contracts-payload';
import { assertTulipContractTypeEnabled } from './contracts-renter';
import type {
  ResolvedTulipItemInput,
  TulipCustomerInput,
  TulipContractType,
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

const TULIP_ALLOWED_CONTRACT_TYPES_BY_PRODUCT_TYPE = {
  bike: ['LCD', 'LMD', 'LLD'],
  'high-tech': ['LCD', 'LMD', 'LLD'],
  watersports: ['LCD', 'LMD', 'LLD'],
  wintersports: ['LCD'],
  event: ['LCD', 'LMD'],
  'small-tools': ['LCD', 'LMD'],
  sports: ['LCD', 'LMD'],
} as const satisfies Record<string, readonly TulipContractType[]>;

type TulipContractCreationSource =
  (typeof dashboardTulipContractCreationSources)[number];

type TargetTulipContractProductEntry = {
  tulipProductId: string;
  louezProductId: string;
  productMarked: string;
  userName: string;
};

type CurrentTulipContractProductEntry = {
  contractProductId: string;
  tulipProductId: string;
  louezProductId: string;
  productMarked: string;
  userName: string;
  status: string;
};

type TulipContractDelta = {
  updates: Array<{
    current: CurrentTulipContractProductEntry;
    target: TargetTulipContractProductEntry;
  }>;
  additions: TargetTulipContractProductEntry[];
  removals: CurrentTulipContractProductEntry[];
};

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

async function assertTulipProductContractCompatibility(params: {
  apiKey: string;
  insuredItems: ResolvedTulipItemInput[];
  contractType: TulipContractType;
}) {
  if (params.insuredItems.length === 0) {
    return;
  }

  const catalog = await tulipListProducts(params.apiKey);
  const productTypeById = new Map<string, string>();

  for (const product of catalog) {
    const productId = product.id?.trim();
    const productType = product.productType?.trim() || '';

    if (productId && productType) {
      productTypeById.set(productId, productType);
    }
  }

  const uniqueInsuredProductIds = new Set(
    params.insuredItems.map((item) => item.tulipProductId),
  );

  for (const tulipProductId of uniqueInsuredProductIds) {
    const productType = productTypeById.get(tulipProductId);
    if (!productType) {
      continue;
    }

    const allowedContractTypes =
      TULIP_ALLOWED_CONTRACT_TYPES_BY_PRODUCT_TYPE[
        productType as keyof typeof TULIP_ALLOWED_CONTRACT_TYPES_BY_PRODUCT_TYPE
      ];

    if (
      allowedContractTypes &&
      !(allowedContractTypes as readonly TulipContractType[]).includes(
        params.contractType,
      )
    ) {
      throw new Error('errors.tulipContractProductsIncompatible');
    }
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

function getTulipTerminationReason(context: 'reservation_cancelled' | 'coverage_removed') {
  if (context === 'reservation_cancelled') {
    return 'Reservation cancelled in Louez';
  }

  return 'Coverage removed from reservation in Louez';
}

function buildTulipTerminationPayload(
  context: 'reservation_cancelled' | 'coverage_removed',
  endDate?: Date,
) {
  return {
    reason: getTulipTerminationReason(context),
    ...(endDate ? { end_date: endDate.toISOString() } : {}),
  };
}

function toTargetTulipContractProductEntries(
  payloadProducts: Array<Record<string, unknown>>,
): TargetTulipContractProductEntry[] {
  const entries: TargetTulipContractProductEntry[] = [];

  for (const product of payloadProducts) {
    if (!product || typeof product !== 'object') {
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

    const tulipProductId =
      typeof productObj.product_id === 'string' ? productObj.product_id.trim() : '';
    const productMarked =
      typeof dataObj?.product_marked === 'string'
        ? dataObj.product_marked.trim()
        : '';
    const userName =
      typeof dataObj?.user_name === 'string' ? dataObj.user_name.trim() : '';
    const louezProductIdValue =
      typeof dataObj?.louez_product_ID === 'string'
        ? dataObj.louez_product_ID.trim()
        : '';

    if (!tulipProductId || !productMarked) {
      continue;
    }

    entries.push({
      tulipProductId,
      louezProductId: louezProductIdValue,
      productMarked,
      userName,
    });
  }

  return entries;
}

function toCurrentTulipContractProductEntries(
  contract: TulipContract,
): CurrentTulipContractProductEntry[] {
  const products = contract.products;
  if (!products || typeof products !== 'object') {
    return [];
  }

  const entries: CurrentTulipContractProductEntry[] = [];
  for (const [contractProductId, product] of Object.entries(products)) {
    if (!product || typeof product !== 'object') {
      continue;
    }

    const productObj = product as TulipContractProduct;
    const dataObj =
      productObj.data && typeof productObj.data === 'object'
        ? productObj.data
        : undefined;
    const status = typeof productObj.status === 'string' ? productObj.status : '';
    const tulipProductId =
      typeof productObj.product_id === 'string' ? productObj.product_id.trim() : '';
    const productMarked =
      typeof dataObj?.product_marked === 'string'
        ? dataObj.product_marked.trim()
        : '';
    const userName =
      typeof dataObj?.user_name === 'string' ? dataObj.user_name.trim() : '';
    const louezProductId =
      typeof dataObj?.louez_product_ID === 'string'
        ? dataObj.louez_product_ID.trim()
        // Legacy fallback: older Tulip contracts stored the Louez id in internal_id.
        : typeof dataObj?.internal_id === 'string'
          ? dataObj.internal_id.trim()
          : '';

    if (!tulipProductId || status !== 'open') {
      continue;
    }

    entries.push({
      contractProductId,
      tulipProductId,
      louezProductId,
      productMarked,
      userName,
      status,
    });
  }

  return entries;
}

function takeFirstMatchingEntry<T>(
  pool: T[],
  predicate: (entry: T) => boolean,
): T | null {
  const matchIndex = pool.findIndex(predicate);
  if (matchIndex === -1) {
    return null;
  }

  const [entry] = pool.splice(matchIndex, 1);
  return entry ?? null;
}

function buildTulipContractDelta(params: {
  currentProducts: CurrentTulipContractProductEntry[];
  targetProducts: TargetTulipContractProductEntry[];
}): TulipContractDelta {
  const remainingCurrent = [...params.currentProducts];
  const remainingTarget = [...params.targetProducts];
  const updates: TulipContractDelta['updates'] = [];

  for (let index = remainingTarget.length - 1; index >= 0; index--) {
    const target = remainingTarget[index];
    const exactMatch = takeFirstMatchingEntry(
      remainingCurrent,
      (current) =>
        current.tulipProductId === target.tulipProductId &&
        current.louezProductId === target.louezProductId &&
        current.productMarked === target.productMarked &&
        current.userName === target.userName,
    );

    if (exactMatch) {
      remainingTarget.splice(index, 1);
    }
  }

  const matchBy = (
    predicate: (
      current: CurrentTulipContractProductEntry,
      target: TargetTulipContractProductEntry,
    ) => boolean,
  ) => {
    for (let index = remainingTarget.length - 1; index >= 0; index--) {
      const target = remainingTarget[index];
      const current = takeFirstMatchingEntry(
        remainingCurrent,
        (entry) => predicate(entry, target),
      );

      if (!current) {
        continue;
      }

      updates.push({ current, target });
      remainingTarget.splice(index, 1);
    }
  };

  matchBy(
    (current, target) =>
      current.louezProductId.length > 0 &&
      current.louezProductId === target.louezProductId,
  );
  matchBy(
    (current, target) =>
      current.productMarked.length > 0 &&
      current.productMarked === target.productMarked,
  );
  matchBy((current, target) => current.tulipProductId === target.tulipProductId);

  return {
    updates,
    additions: remainingTarget,
    removals: remainingCurrent,
  };
}

function shouldIncludeTulipIdentityPayload(
  currentContract: TulipContract,
  targetPayload: Record<string, unknown>,
): boolean {
  const currentContractType =
    typeof currentContract.contract_type === 'string'
      ? currentContract.contract_type
      : null;
  const nextContractType =
    typeof targetPayload.contract_type === 'string'
      ? targetPayload.contract_type
      : null;

  if (currentContractType !== nextContractType) {
    return true;
  }

  const currentOptions = Array.isArray(currentContract.options)
    ? currentContract.options.filter(
        (option): option is string => typeof option === 'string',
      )
    : [];
  const nextOptions = Array.isArray(targetPayload.options)
    ? targetPayload.options.filter(
        (option): option is string => typeof option === 'string',
      )
    : [];

  if (
    currentOptions.length !== nextOptions.length ||
    currentOptions.some((option) => !nextOptions.includes(option))
  ) {
    return true;
  }

  return false;
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

  await assertTulipProductContractCompatibility({
    apiKey,
    insuredItems: coverage.insuredItems,
    contractType: resolvedContractType,
  });

  const payload = buildContractPayload({
    renterUid: tulipSettings.renterUid,
    contractType: resolvedContractType,
    startDate: params.startDate,
    endDate: params.endDate,
    customer: params.customer,
    insuredItems: coverage.insuredItems,
    preview: true,
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

  const resetCreationLock = async () => {
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
  };

  let payload: ReturnType<typeof buildContractPayload> | null = null;
  let contractId: string | null = null;
  try {
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

    await assertTulipProductContractCompatibility({
      apiKey,
      insuredItems,
      contractType: resolvedContractType,
    });

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

    payload = buildContractPayload({
      renterUid: tulipSettings.renterUid,
      contractType: resolvedContractType,
      startDate: reservation.startDate,
      endDate: reservation.endDate,
      customer: toTulipCustomerInput(reservation.customer),
      insuredItems,
    });

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
      request: payload ? summarizeContractPayloadForLogs(payload) : null,
      error: error instanceof Error ? error.message : 'unknown',
    });
    await resetCreationLock();
    if (error instanceof Error && error.message.startsWith('errors.')) {
      throw error;
    }
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
    await tulipCancelContract(
      apiKey,
      contractId,
      buildTulipTerminationPayload('coverage_removed'),
      false,
    );
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

  await assertTulipProductContractCompatibility({
    apiKey,
    insuredItems,
    contractType: resolvedContractType,
  });

  if (coverage.insuredProductCount === 0) {
    await tulipCancelContract(
      apiKey,
      contractId,
      buildTulipTerminationPayload('coverage_removed'),
      false,
    );
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
  const currentContract = await tulipGetContract(apiKey, contractId);
  if (currentContract.status !== 'open') {
    throw new Error('errors.tulipContractNotOpen');
  }

  const currentStartDate = currentContract.start_date
    ? new Date(currentContract.start_date)
    : null;
  const currentEndDate = currentContract.end_date
    ? new Date(currentContract.end_date)
    : null;

  if (
    reservation.startDate.getTime() < Date.now() &&
    (!currentStartDate ||
      currentStartDate.getTime() !== reservation.startDate.getTime())
  ) {
    throw new Error('errors.tulipContractPastDate');
  }

  const targetProducts = toTargetTulipContractProductEntries(
    Array.isArray(createPayload.products) ? createPayload.products : [],
  );
  const currentProducts = toCurrentTulipContractProductEntries(currentContract);
  const delta = buildTulipContractDelta({
    currentProducts,
    targetProducts,
  });

  const swapProductsPayload = Object.fromEntries(
    delta.updates
      .filter(
        ({ current, target }) =>
          current.tulipProductId !== target.tulipProductId ||
          current.productMarked !== target.productMarked ||
          current.userName !== target.userName ||
          current.louezProductId !== target.louezProductId,
      )
      .map(({ current, target }) => [
        current.contractProductId,
        {
          product_id: target.tulipProductId,
          product_marked: target.productMarked,
          user_name: target.userName,
          louez_product_ID: target.louezProductId,
        },
      ]),
  );

  const shouldPatchStartDate =
    !currentStartDate ||
    currentStartDate.getTime() !== reservation.startDate.getTime();
  const shouldPatchEndDate =
    !currentEndDate ||
    currentEndDate.getTime() !== reservation.endDate.getTime();
  const shouldPatchIdentity = shouldIncludeTulipIdentityPayload(
    currentContract,
    createPayload as unknown as Record<string, unknown>,
  );

  if (shouldPatchStartDate && currentStartDate) {
    const elapsedMs = Date.now() - currentStartDate.getTime();
    if (
      reservation.startDate.getTime() !== currentStartDate.getTime() &&
      elapsedMs > 4 * 60 * 60 * 1000
    ) {
      throw new Error('errors.tulipContractUpdateWindowExpired');
    }
  }

  const shouldPatchContract =
    shouldPatchStartDate ||
    shouldPatchEndDate ||
    Object.keys(swapProductsPayload).length > 0 ||
    shouldPatchIdentity;

  if (shouldPatchContract) {
    const updatePayload: Record<string, unknown> = {};

    if (shouldPatchEndDate || shouldPatchIdentity) {
      updatePayload.end_date = createPayload.end_date;
    }

    if (shouldPatchIdentity) {
      updatePayload.contract_type = createPayload.contract_type;
      updatePayload.options = createPayload.options;
    }

    if (shouldPatchStartDate) {
      updatePayload.start_date = createPayload.start_date;
    }

    if (Object.keys(swapProductsPayload).length > 0) {
      updatePayload.products = swapProductsPayload;
    }

    if (shouldPatchIdentity) {
      if (createPayload.company) {
        updatePayload.company = createPayload.company;
      }
      if (createPayload.individual) {
        updatePayload.individual = createPayload.individual;
      }
    }

    try {
      await tulipUpdateContract(apiKey, contractId, updatePayload, false);
    } catch (error) {
      console.warn('[tulip][contract-sync] patch failed', {
        reservationId: reservation.id,
        contractId,
        payload: updatePayload,
        error: error instanceof Error ? error.message : 'unknown',
        payloadDetails: error instanceof TulipApiError ? error.payload : null,
      });
      throw toTulipContractError(error, 'errors.tulipContractUpdateFailed');
    }
  }

  if (delta.additions.length > 0) {
    const addStartDate = new Date(
      Math.max(
        Date.now(),
        reservation.startDate.getTime(),
        currentStartDate?.getTime() ?? reservation.startDate.getTime(),
      ),
    );
    const addPayload = {
      // Tulip's add-products endpoint rejects otherwise-valid requests
      // unless the renter uid is repeated at the payload root.
      uid: renterUid,
      start_date: addStartDate.toISOString(),
      products: delta.additions.map((product) => ({
        product_id: product.tulipProductId,
        data: {
          user_name: product.userName,
          product_marked: product.productMarked,
          louez_product_ID: product.louezProductId,
        },
      })),
    };

    try {
      await tulipAddProductsToContract(apiKey, contractId, addPayload, false);
    } catch (error) {
      console.warn('[tulip][contract-sync] add products failed', {
        reservationId: reservation.id,
        contractId,
        payload: addPayload,
        error: error instanceof Error ? error.message : 'unknown',
        payloadDetails: error instanceof TulipApiError ? error.payload : null,
      });
      throw toTulipContractError(error, 'errors.tulipContractUpdateFailed');
    }
  }

  if (delta.removals.length > 0) {
    const deletePayload = {
      ...buildTulipTerminationPayload('coverage_removed'),
      products: delta.removals.map((product) => product.contractProductId),
    };

    try {
      await tulipDeleteProductsFromContract(apiKey, contractId, deletePayload, false);
    } catch (error) {
      console.warn('[tulip][contract-sync] remove products failed', {
        reservationId: reservation.id,
        contractId,
        payload: deletePayload,
        error: error instanceof Error ? error.message : 'unknown',
        payloadDetails: error instanceof TulipApiError ? error.payload : null,
      });
      throw toTulipContractError(error, 'errors.tulipContractUpdateFailed');
    }
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
    action:
      shouldPatchContract || delta.additions.length > 0 || delta.removals.length > 0
        ? ('updated' as const)
        : ('unchanged' as const),
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

  await tulipCancelContract(
    apiKey,
    reservation.tulipContractId,
    buildTulipTerminationPayload('reservation_cancelled'),
    false,
  );

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
