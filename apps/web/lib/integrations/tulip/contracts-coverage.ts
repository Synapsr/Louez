import { inArray } from 'drizzle-orm';

import { db, productsTulip } from '@louez/db';

import type {
  ResolvedTulipItemInput,
  TulipCoverageResolution,
  TulipCoverageSummary,
  TulipItemInput,
} from './contracts-types';

async function getTulipMappingMap(
  productIds: string[],
): Promise<Map<string, { tulipProductId: string }>> {
  if (productIds.length === 0) {
    return new Map();
  }

  const mappings = await db.query.productsTulip.findMany({
    where: inArray(productsTulip.productId, productIds),
    columns: {
      productId: true,
      tulipProductId: true,
    },
  });

  return new Map(
    mappings.map((mapping) => [
      mapping.productId,
      {
        tulipProductId: mapping.tulipProductId,
      },
    ]),
  );
}

function getCoverageSummary(
  sourceItems: TulipItemInput[],
  insuredItems: ResolvedTulipItemInput[],
): TulipCoverageSummary {
  const sourceProductIds = new Set(sourceItems.map((item) => item.productId));
  const insuredProductIds = new Set(insuredItems.map((item) => item.productId));

  return {
    insuredProductCount: insuredProductIds.size,
    uninsuredProductCount: Math.max(sourceProductIds.size - insuredProductIds.size, 0),
    insuredProductIds: Array.from(insuredProductIds),
  };
}

export async function resolveTulipCoverage(
  items: TulipItemInput[],
): Promise<TulipCoverageResolution> {
  if (items.length === 0) {
    return {
      insuredItems: [],
      insuredProductCount: 0,
      uninsuredProductCount: 0,
      insuredProductIds: [],
    };
  }

  const productIds = [...new Set(items.map((item) => item.productId))];
  const mappingMap = await getTulipMappingMap(productIds);

  const insuredItems: ResolvedTulipItemInput[] = [];
  for (const item of items) {
    const mapping = mappingMap.get(item.productId);
    if (!mapping?.tulipProductId) {
      continue;
    }

    insuredItems.push({
      productId: item.productId,
      tulipProductId: mapping.tulipProductId,
      quantity: item.quantity,
    });
  }

  return {
    insuredItems,
    ...getCoverageSummary(items, insuredItems),
  };
}

export async function getTulipCoverageSummary(
  items: TulipItemInput[],
): Promise<TulipCoverageSummary> {
  const coverage = await resolveTulipCoverage(items);
  return {
    insuredProductCount: coverage.insuredProductCount,
    uninsuredProductCount: coverage.uninsuredProductCount,
    insuredProductIds: coverage.insuredProductIds,
  };
}
