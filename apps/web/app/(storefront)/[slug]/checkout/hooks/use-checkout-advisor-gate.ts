'use client';

import { useEffect, useRef } from 'react';

import { useQuery } from '@tanstack/react-query';

import type { AiAdvisorMode } from '@louez/types';

import { useAdvisor } from '@/contexts/advisor-context';
import { useCart } from '@/contexts/cart-context';
import { orpc } from '@/lib/orpc';

export interface CheckoutAdvisorGate {
  /** Advisor participates in this checkout (recommended or required mode). */
  isActive: boolean;
  isRequired: boolean;
  /**
   * Validated for the CURRENT cart: the conversation is validated and covers
   * every cart product (mirrors the server-side check in createReservation).
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
  const { items } = useCart();

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

  // Re-check when the widget signals a validation or closes.
  const wasOpenRef = useRef(isOpen);
  useEffect(() => {
    const widgetJustClosed = wasOpenRef.current && !isOpen;
    wasOpenRef.current = isOpen;
    if (isRequired && conversationId && (widgetJustClosed || validationVersion > 0)) {
      refetchStatus();
    }
  }, [isOpen, validationVersion, isRequired, conversationId, refetchStatus]);

  const validatedProductIds = new Set(
    statusQuery.data?.validatedProductIds ?? [],
  );
  const isValidated =
    Boolean(statusQuery.data?.validated) &&
    items.every((item) => validatedProductIds.has(item.productId));

  return {
    isActive,
    isRequired,
    isValidated,
    isStatusLoading: isRequired && conversationId !== null && statusQuery.isPending,
    conversationId,
    openAdvisor: () => open({ intent: 'checkout' }),
  };
}
