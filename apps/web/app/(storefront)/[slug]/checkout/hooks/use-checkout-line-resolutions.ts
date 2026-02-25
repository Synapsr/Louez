import { useEffect, useMemo, useState } from 'react';

import type { CartItem } from '@/contexts/cart-context';
import { orpcClient } from '@/lib/orpc/react';

import type { LineResolutionState } from '../types';

interface UseCheckoutLineResolutionsParams {
  items: CartItem[];
}

export function useCheckoutLineResolutions({
  items,
}: UseCheckoutLineResolutionsParams) {
  const [lineResolutions, setLineResolutions] = useState<
    Record<string, LineResolutionState>
  >({});

  useEffect(() => {
    let cancelled = false;

    async function resolveCombinations() {
      if (items.length === 0) {
        setLineResolutions({});
        return;
      }

      const loadingState = Object.fromEntries(
        items.map((item) => [item.lineId, { status: 'loading' as const }]),
      );
      setLineResolutions(loadingState);

      const nextResolved: Record<string, LineResolutionState> = {};

      await Promise.all(
        items.map(async (item) => {
          try {
            const result =
              await orpcClient.storefront.availability.resolveCombination({
                productId: item.productId,
                quantity: item.quantity,
                startDate: item.startDate,
                endDate: item.endDate,
                selectedAttributes: item.selectedAttributes,
              });

            nextResolved[item.lineId] = {
              status: 'resolved',
              combinationKey: result.combinationKey,
              selectedAttributes: result.selectedAttributes,
            };
          } catch {
            nextResolved[item.lineId] = { status: 'invalid' };
          }
        }),
      );

      if (!cancelled) {
        setLineResolutions(nextResolved);
      }
    }

    resolveCombinations();

    return () => {
      cancelled = true;
    };
  }, [items]);

  const {
    itemsWithResolved,
    hasInvalidLines,
    hasUnresolvedLines,
    canSubmitCheckout,
  } = useMemo(() => {
    const summary = items.reduce<{
      itemsWithResolved: CartItem[];
      hasInvalidLines: boolean;
      hasUnresolvedLines: boolean;
    }>(
      (acc, item) => {
        const resolved = lineResolutions[item.lineId];

        if (!resolved || resolved.status === 'loading') {
          return {
            ...acc,
            itemsWithResolved: [...acc.itemsWithResolved, item],
            hasUnresolvedLines: true,
          };
        }

        if (resolved.status === 'invalid') {
          return {
            ...acc,
            itemsWithResolved: [...acc.itemsWithResolved, item],
            hasInvalidLines: true,
          };
        }

        return {
          ...acc,
          itemsWithResolved: [
            ...acc.itemsWithResolved,
            {
              ...item,
              resolvedCombinationKey: resolved.combinationKey,
              resolvedAttributes: resolved.selectedAttributes,
            },
          ],
        };
      },
      {
        itemsWithResolved: [],
        hasInvalidLines: false,
        hasUnresolvedLines: false,
      },
    );

    return {
      itemsWithResolved: summary.itemsWithResolved,
      hasInvalidLines: summary.hasInvalidLines,
      hasUnresolvedLines: summary.hasUnresolvedLines,
      canSubmitCheckout:
        !summary.hasInvalidLines && !summary.hasUnresolvedLines,
    };
  }, [items, lineResolutions]);

  return {
    lineResolutions,
    itemsWithResolved,
    hasInvalidLines,
    hasUnresolvedLines,
    canSubmitCheckout,
  };
}
