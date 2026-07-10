'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';

import { useChat } from '@ai-sdk/react';
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithToolCalls,
} from 'ai';
import { z } from 'zod';

import type { AdvisorCartSnapshot } from '@louez/validations';

import { useCart } from '@/contexts/cart-context';
import { useAdvisor } from '@/contexts/advisor-context';
import { orpcClient } from '@/lib/orpc';

import { AdvisorLauncher } from './advisor-launcher';
import { AdvisorPanel } from './advisor-panel';

const addToCartInputSchema = z.object({
  productId: z.string(),
  quantity: z.number().int().min(1).max(999),
  startDate: z.string(),
  endDate: z.string(),
});

type AdvisorWidgetProps = {
  storeSlug: string;
  displayName?: string;
  welcomeMessage?: string;
};

export function AdvisorWidget({
  storeSlug,
  displayName,
  welcomeMessage,
}: AdvisorWidgetProps) {
  const {
    isOpen,
    open,
    close,
    intent,
    clearIntent,
    conversationId,
    setConversationId,
    notifyValidated,
  } = useAdvisor();
  const cart = useCart();

  // Latest state via refs: the transport body and tool handler run outside
  // the render cycle and must never see stale closures.
  const conversationIdRef = useRef<string | null>(conversationId);
  conversationIdRef.current = conversationId;

  const cartSnapshotRef = useRef<AdvisorCartSnapshot>({ items: [] });
  cartSnapshotRef.current = {
    items: cart.items.map((item) => ({
      productId: item.productId,
      quantity: item.quantity,
    })),
    startDate: cart.globalStartDate ?? undefined,
    endDate: cart.globalEndDate ?? undefined,
  };

  const cartActionsRef = useRef(cart);
  cartActionsRef.current = cart;

  // Capture the conversation id issued by the API on first message
  const customFetch = useCallback(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const res = await fetch(input, init);
      const newConversationId = res.headers.get('X-Conversation-Id');
      if (
        newConversationId &&
        newConversationId !== conversationIdRef.current
      ) {
        setConversationId(newConversationId);
      }
      return res;
    },
    [setConversationId],
  );

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: '/api/storefront/chat',
        headers: () => ({ 'x-store-slug': storeSlug }),
        body: () => ({
          conversationId: conversationIdRef.current ?? undefined,
          cart: cartSnapshotRef.current,
        }),
        fetch: customFetch,
      }),
    [storeSlug, customFetch],
  );

  /**
   * Client-side execution of the advisor's add_to_cart tool. Pricing and
   * availability are resolved server-side through the same endpoint the cart
   * itself uses; the local cart state is only updated on success.
   */
  const handleAddToCart = useCallback(
    async (rawInput: unknown) => {
      const parsed = addToCartInputSchema.safeParse(rawInput);
      if (!parsed.success) {
        return { success: false as const, reason: 'invalid_input' };
      }
      const { productId, quantity } = parsed.data;
      // Models sometimes emit datetimes without a timezone offset — normalize
      // to strict ISO 8601, which the cart endpoints require.
      const startMs = Date.parse(parsed.data.startDate);
      const endMs = Date.parse(parsed.data.endDate);
      if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs <= startMs) {
        return { success: false as const, reason: 'invalid_dates' };
      }
      const startDate = new Date(startMs).toISOString();
      const endDate = new Date(endMs).toISOString();
      const currentCart = cartActionsRef.current;

      // The cart has one global rental period: adding with different dates
      // to a non-empty cart is a conflict the model must resolve with the
      // customer, never a silent override.
      if (
        currentCart.items.length > 0 &&
        currentCart.globalStartDate &&
        currentCart.globalEndDate &&
        (new Date(currentCart.globalStartDate).getTime() !==
          new Date(startDate).getTime() ||
          new Date(currentCart.globalEndDate).getTime() !==
            new Date(endDate).getTime())
      ) {
        return {
          success: false as const,
          reason: 'date_conflict',
          cartStartDate: currentCart.globalStartDate,
          cartEndDate: currentCart.globalEndDate,
        };
      }

      try {
        const resolved = await orpcClient.storefront.cart.resolve({
          lines: [
            { lineId: 'advisor-add', productId, quantity, startDate, endDate },
          ],
        });
        const line = resolved.lines[0];
        if (!line || line.status !== 'resolved') {
          return {
            success: false as const,
            reason:
              line?.status === 'unavailable' ? line.reason : 'unavailable',
          };
        }

        currentCart.addItem(
          {
            productId,
            productName: line.productName,
            productImage: line.productImage,
            price: line.price,
            deposit: line.deposit,
            quantity,
            maxQuantity: line.maxQuantity,
            pricingTiers: line.pricingTiers,
            basePeriodMinutes: line.basePeriodMinutes,
            enforceStrictTiers: line.enforceStrictTiers,
            productPricingMode: line.productPricingMode,
            seasonalPricings: line.seasonalPricings,
            pricingMode: line.pricingMode,
          },
          storeSlug,
        );
        // AFTER addItem: setGlobalDates remaps every line (the freshly added
        // one included) through a state updater, overriding whatever period
        // addItem inherited from a stale render closure.
        if (currentCart.items.length === 0) {
          currentCart.setGlobalDates(startDate, endDate);
        }

        return { success: true as const, productName: line.productName };
      } catch {
        return { success: false as const, reason: 'error' };
      }
    },
    [storeSlug],
  );

  const {
    messages,
    sendMessage,
    status,
    setMessages,
    error,
    clearError,
    addToolResult,
  } = useChat({
    transport,
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
    async onToolCall({ toolCall }) {
      if (toolCall.toolName === 'add_to_cart') {
        const output = await handleAddToCart(toolCall.input);
        addToolResult({
          tool: 'add_to_cart',
          toolCallId: toolCall.toolCallId,
          output,
        });
      }
    },
  });

  // Surface advisor validation to the checkout gate (record_qualification
  // tool output with validated=true).
  const notifiedValidationsRef = useRef(new Set<string>());
  useEffect(() => {
    for (const message of messages) {
      for (const part of message.parts) {
        if (
          part.type === 'tool-record_qualification' &&
          part.state === 'output-available' &&
          (part.output as { validated?: boolean } | undefined)?.validated &&
          !notifiedValidationsRef.current.has(part.toolCallId)
        ) {
          notifiedValidationsRef.current.add(part.toolCallId);
          notifyValidated();
        }
      }
    }
  }, [messages, notifyValidated]);

  const isLoading = status === 'submitted' || status === 'streaming';

  const handleSend = useCallback(
    (text: string) => {
      if (!text.trim() || isLoading) return;
      clearError();
      sendMessage({ text: text.trim() });
    },
    [isLoading, clearError, sendMessage],
  );

  const handleRestart = useCallback(() => {
    setConversationId(null);
    setMessages([]);
    clearError();
  }, [setConversationId, setMessages, clearError]);

  return (
    <>
      <AdvisorLauncher isOpen={isOpen} onClick={() => open()} />
      <AdvisorPanel
        isOpen={isOpen}
        onClose={close}
        displayName={displayName}
        welcomeMessage={welcomeMessage}
        intent={intent}
        onIntentConsumed={clearIntent}
        messages={messages}
        isLoading={isLoading}
        hasError={Boolean(error)}
        errorCode={error?.message?.trim() ?? ''}
        onSend={handleSend}
        onRestart={handleRestart}
      />
    </>
  );
}
