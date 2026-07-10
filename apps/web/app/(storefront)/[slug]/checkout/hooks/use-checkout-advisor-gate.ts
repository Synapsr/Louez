'use client';

import { useEffect, useRef } from 'react';

import { useQuery } from '@tanstack/react-query';

import type { AiAdvisorMode } from '@louez/types';
import { advisorValidationCovers } from '@louez/utils';

import { useAdvisor } from '@/contexts/advisor-context';
import { useCart } from '@/contexts/cart-context';
import { orpc } from '@/lib/orpc';

export interface CheckoutAdvisorGate {
  /** Advisor participates in this checkout (recommended or required mode). */
  isActive: boolean;
  isRequired: boolean;
  /**
   * Validated for the CURRENT cart — same products, quantities and rental
   * period (mirrors the server-side check in createReservation, through the
   * shared advisorValidationCovers helper).
   */
  isValidated: boolean;
  isStatusLoading: boolean;
  conversationId: string | null;
  openAdvisor: () => void;
}

/**
 * Checkout-side view of the advisor validation state. The server re-enforces
 * everything in createReservation — this hook only drives the gate UI.
 */
export function useCheckoutAdvisorGate(
  advisorMode: AiAdvisorMode | null,
): CheckoutAdvisorGate {
  const { enabled, open, isOpen, conversationId, validationVersion } =
    useAdvisor();
  const { items, globalStartDate, globalEndDate } = useCart();

  const isActive =
    enabled && (advisorMode === 'recommended' || advisorMode === 'required');
  const isRequired = enabled && advisorMode === 'required';

  const statusQuery = useQuery({
    ...orpc.storefront.aiAdvisor.getConversationStatus.queryOptions({
      input: { conversationId: conversationId ?? '' },
    }),
    enabled: isRequired && conversationId !== null,
  });
  const refetchStatus = statusQuery.refetch;

  // Re-check when the widget signals a fresh validation or closes.
  const wasOpenRef = useRef(isOpen);
  const seenValidationVersionRef = useRef(validationVersion);
  useEffect(() => {
    const widgetJustClosed = wasOpenRef.current && !isOpen;
    wasOpenRef.current = isOpen;
    const validationChanged =
      validationVersion !== seenValidationVersionRef.current;
    seenValidationVersionRef.current = validationVersion;
    if (isRequired && conversationId && (widgetJustClosed || validationChanged)) {
      refetchStatus();
    }
  }, [isOpen, validationVersion, isRequired, conversationId, refetchStatus]);

  const isValidated =
    Boolean(statusQuery.data?.validated) &&
    advisorValidationCovers(statusQuery.data?.validatedCart, {
      items: items.map((item) => ({
        productId: item.productId,
        quantity: item.quantity,
      })),
      startDate: globalStartDate,
      endDate: globalEndDate,
    });

  return {
    isActive,
    isRequired,
    isValidated,
    isStatusLoading:
      isRequired && conversationId !== null && statusQuery.isPending,
    conversationId,
    openAdvisor: () => open({ intent: 'checkout' }),
  };
}
