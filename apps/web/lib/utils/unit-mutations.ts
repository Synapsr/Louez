import { eq, inArray } from 'drizzle-orm';
import { nanoid } from 'nanoid';

import { db, productUnitEvents, productUnits } from '@louez/db';

type UnitMutationTx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type UnitEventType = (typeof productUnitEvents.$inferInsert)['type'];
type UnitEventPayload = Record<string, unknown> | null;

type UnitEventInput = {
  storeId: string;
  actorUserId: string | null;
  type: UnitEventType;
  payload?: UnitEventPayload;
  identifierSnapshot: string;
};

type UnitValues = typeof productUnits.$inferInsert & {
  id: string;
  identifier: string;
};

type CreateUnitMutation = {
  unit: UnitValues;
  event: Omit<UnitEventInput, 'type'> & {
    type?: UnitEventType;
  };
};

export type UpdateUnitMutation = {
  unitId: string;
  values: Partial<typeof productUnits.$inferInsert>;
  event: UnitEventInput;
};

type DeleteUnitMutation = {
  unitId: string;
  event: UnitEventInput;
};

export function buildUnitEvent({
  productUnitId,
  event,
}: {
  productUnitId: string;
  event: UnitEventInput;
}): typeof productUnitEvents.$inferInsert {
  return {
    id: nanoid(),
    productUnitId,
    identifierSnapshot: event.identifierSnapshot,
    storeId: event.storeId,
    type: event.type,
    actorUserId: event.actorUserId,
    payload: event.payload ?? null,
  };
}

export async function createUnits(
  tx: UnitMutationTx,
  mutations: CreateUnitMutation[],
) {
  if (mutations.length === 0) {
    return;
  }

  await tx.insert(productUnits).values(mutations.map(({ unit }) => unit));
  await tx.insert(productUnitEvents).values(
    mutations.map(({ unit, event }) =>
      buildUnitEvent({
        productUnitId: unit.id,
        event: {
          ...event,
          type: event.type ?? 'created',
        },
      }),
    ),
  );
}

export async function updateUnits(
  tx: UnitMutationTx,
  mutations: UpdateUnitMutation[],
) {
  for (const mutation of mutations) {
    await tx
      .update(productUnits)
      .set({
        ...mutation.values,
        updatedAt: new Date(),
      })
      .where(eq(productUnits.id, mutation.unitId));

    await tx.insert(productUnitEvents).values(
      buildUnitEvent({
        productUnitId: mutation.unitId,
        event: mutation.event,
      }),
    );
  }
}

export async function deleteUnits(
  tx: UnitMutationTx,
  mutations: DeleteUnitMutation[],
) {
  if (mutations.length === 0) {
    return;
  }

  await tx.insert(productUnitEvents).values(
    mutations.map((mutation) =>
      buildUnitEvent({
        productUnitId: mutation.unitId,
        event: mutation.event,
      }),
    ),
  );

  await tx.delete(productUnits).where(
    inArray(
      productUnits.id,
      mutations.map((mutation) => mutation.unitId),
    ),
  );
}
