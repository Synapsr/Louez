'use client';

import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { useChat } from '@ai-sdk/react';
import type { UIMessage } from '@ai-sdk/react';
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithToolCalls,
} from 'ai';
import { z } from 'zod';

import type { AdvisorCartSnapshot } from '@louez/validations';

import {
  VERIFICATION_KICKOFF_PROMPT,
  isVerificationKickoff,
} from '@/lib/ai/advisor/kickoff';
import { useCart } from '@/contexts/cart-context';
import { orpcClient } from '@/lib/orpc';

/**
 * Why the widget was opened. 'checkout' surfaces the reservation-validation
 * suggestion chip (required/recommended modes).
 */
export type AdvisorIntent = 'checkout' | null;

/**
 * Stable controls + conversation identity. Its value only changes on genuine
 * control-state changes (open/close, conversation id, validation), NOT on every
 * streamed token — so consumers that need only these (the checkout gate, the
 * launcher) never re-render while a reply streams.
 */
interface AdvisorControlValue {
  /** Whether the advisor is enabled for this store (widget rendered). */
  enabled: boolean;
  isOpen: boolean;
  open: (options?: { intent?: 'checkout' }) => void;
  close: () => void;
  intent: AdvisorIntent;
  clearIntent: () => void;
  /** Current conversation id, persisted per store in localStorage. */
  conversationId: string | null;
  setConversationId: (id: string | null) => void;
  /** Bumped when the advisor validates the conversation — checkout refetches. */
  validationVersion: number;
  notifyValidated: () => void;
  /**
   * True while an inline chat surface (the checkout verification panel) is
   * mounted. The floating launcher/panel step aside so exactly one chat
   * surface is ever visible.
   */
  inlineActive: boolean;
  setInlineActive: (active: boolean) => void;
}

/**
 * The live chat runtime. Its value changes on every streamed token, so only
 * the two chat views (floating panel, inline checkout panel) subscribe to it.
 */
interface AdvisorRuntimeValue {
  messages: UIMessage[];
  isLoading: boolean;
  /** True while the persisted conversation is being rehydrated on load. */
  isHydrating: boolean;
  hasError: boolean;
  errorCode: string;
  send: (text: string) => void;
  /**
   * Auto-start the required-mode checkout verification: sends a hidden kickoff
   * turn so the advisor opens directly on its first verification question. A
   * no-op once the conversation already has messages.
   */
  startVerification: () => void;
  restart: () => void;
  displayName?: string;
  welcomeMessage?: string;
}

const AdvisorControlContext = createContext<AdvisorControlValue | undefined>(
  undefined,
);
const AdvisorRuntimeContext = createContext<AdvisorRuntimeValue | undefined>(
  undefined,
);

const storageKey = (storeSlug: string) => `louez_advisor_${storeSlug}`;

const addToCartInputSchema = z.object({
  productId: z.string(),
  quantity: z.number().int().min(1).max(999),
  startDate: z.string(),
  endDate: z.string(),
});

/** Strict ISO 8601 (with offset) or undefined — never an invalid string. */
function toStrictIso(value: string | null): string | undefined {
  if (!value) return undefined;
  const time = Date.parse(value);
  return Number.isNaN(time) ? undefined : new Date(time).toISOString();
}

export function AdvisorProvider({
  children,
  storeSlug,
  enabled,
  displayName,
  welcomeMessage,
}: {
  children: ReactNode;
  storeSlug: string;
  enabled: boolean;
  displayName?: string;
  welcomeMessage?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [intent, setIntent] = useState<AdvisorIntent>(null);
  const [conversationId, setConversationIdState] = useState<string | null>(
    null,
  );
  const [validationVersion, setValidationVersion] = useState(0);
  const [inlineActive, setInlineActive] = useState(false);
  // False until the initial conversation state is known (no stored id, or a
  // rehydration attempt has finished) — gates the checkout auto-start so it
  // never races the transcript fetch on reload.
  const [hydrated, setHydrated] = useState(false);

  const cart = useCart();

  useEffect(() => {
    try {
      const stored = localStorage.getItem(storageKey(storeSlug));
      setConversationIdState(stored);
      // No stored conversation → nothing to rehydrate; hydration is done.
      if (!stored) setHydrated(true);
    } catch {
      // Storage unavailable — the conversation just won't persist
      setHydrated(true);
    }
  }, [storeSlug]);

  const setConversationId = useCallback(
    (id: string | null) => {
      setConversationIdState(id);
      try {
        if (id) {
          localStorage.setItem(storageKey(storeSlug), id);
        } else {
          localStorage.removeItem(storageKey(storeSlug));
        }
      } catch {
        // Storage unavailable — the conversation just won't persist
      }
    },
    [storeSlug],
  );

  const open = useCallback(
    (options?: { intent?: 'checkout' }) => {
      if (!enabled) return;
      if (options?.intent) setIntent(options.intent);
      setIsOpen(true);
    },
    [enabled],
  );

  const close = useCallback(() => setIsOpen(false), []);
  const clearIntent = useCallback(() => setIntent(null), []);
  const notifyValidated = useCallback(
    () => setValidationVersion((version) => version + 1),
    [],
  );

  // Latest state via refs: the transport body and tool handler run outside the
  // render cycle and must never see stale closures.
  const conversationIdRef = useRef<string | null>(conversationId);
  conversationIdRef.current = conversationId;

  const cartRef = useRef(cart);
  cartRef.current = cart;

  // Capture the conversation id issued by the API on first message.
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
        body: (): {
          conversationId: string | undefined;
          cart: AdvisorCartSnapshot;
        } => {
          const currentCart = cartRef.current;
          return {
            conversationId: conversationIdRef.current ?? undefined,
            cart: {
              items: currentCart.items.map((item) => ({
                productId: item.productId,
                quantity: item.quantity,
              })),
              // Cart dates come from localStorage — normalize to strict ISO
              // (the API schema requires an offset) and drop invalid values.
              startDate: toStrictIso(currentCart.globalStartDate),
              endDate: toStrictIso(currentCart.globalEndDate),
            },
          };
        },
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
      const currentCart = cartRef.current;

      // The cart has one global rental period: adding with different dates to a
      // non-empty cart is a conflict the model must resolve with the customer,
      // never a silent override.
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

        return {
          success: true as const,
          productName: line.productName,
          // addItem merges same-product lines and caps at availability — tell
          // the model so it never overstates what is in the cart.
          requestedQuantity: quantity,
          maxAvailableQuantity: line.maxQuantity,
        };
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

  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  // Rehydrate the thread after a page reload: the conversation id survives in
  // localStorage but useChat state does not. A stale/unknown id resets to a
  // fresh conversation instead of erroring. Inert when the advisor is off so a
  // disabled store fires no chat network calls.
  const hydratedConversationRef = useRef<string | null>(null);
  useEffect(() => {
    if (!enabled) {
      setHydrated(true);
      return;
    }
    if (!conversationId || hydratedConversationRef.current === conversationId) {
      return;
    }
    hydratedConversationRef.current = conversationId;
    if (messagesRef.current.length > 0) {
      setHydrated(true);
      return;
    }

    let cancelled = false;
    orpcClient.storefront.aiAdvisor
      .getMessages({ conversationId })
      .then(({ messages: stored }) => {
        if (cancelled || stored.length === 0) return;
        if (messagesRef.current.length > 0) return;
        setMessages(
          stored.map((message) => ({
            id: message.id,
            role: message.role,
            parts: [{ type: 'text' as const, text: message.content }],
          })),
        );
      })
      .catch(() => {
        if (!cancelled) setConversationId(null);
      })
      .finally(() => {
        if (!cancelled) setHydrated(true);
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, conversationId, setConversationId, setMessages]);

  // Surface advisor validation to the checkout gate (record_qualification tool
  // output with validated=true). This is the trigger that flips the inline
  // verification panel and the confirm button to the validated state.
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

  const send = useCallback(
    (text: string) => {
      if (!enabled || !text.trim() || isLoading) return;
      clearError();
      sendMessage({ text: text.trim() });
    },
    [enabled, isLoading, clearError, sendMessage],
  );

  const startVerification = useCallback(() => {
    if (!enabled || isLoading) return;
    // Fire once per conversation: bail only if a kickoff sentinel is already in
    // the thread (fresh, rehydrated, or validated). Prior *browsing* messages
    // must NOT block the verification from starting.
    if (messagesRef.current.some(isVerificationKickoff)) return;
    clearError();
    sendMessage({ text: VERIFICATION_KICKOFF_PROMPT });
  }, [enabled, isLoading, clearError, sendMessage]);

  const restart = useCallback(() => {
    setConversationId(null);
    setMessages([]);
    clearError();
  }, [setConversationId, setMessages, clearError]);

  const control = useMemo<AdvisorControlValue>(
    () => ({
      enabled,
      isOpen,
      open,
      close,
      intent,
      clearIntent,
      conversationId,
      setConversationId,
      validationVersion,
      notifyValidated,
      inlineActive,
      setInlineActive,
    }),
    [
      enabled,
      isOpen,
      open,
      close,
      intent,
      clearIntent,
      conversationId,
      setConversationId,
      validationVersion,
      notifyValidated,
      inlineActive,
    ],
  );

  const runtime = useMemo<AdvisorRuntimeValue>(
    () => ({
      messages,
      isLoading,
      isHydrating: !hydrated,
      hasError: Boolean(error),
      errorCode: error?.message?.trim() ?? '',
      send,
      startVerification,
      restart,
      displayName,
      welcomeMessage,
    }),
    [
      messages,
      isLoading,
      hydrated,
      error,
      send,
      startVerification,
      restart,
      displayName,
      welcomeMessage,
    ],
  );

  return (
    <AdvisorControlContext.Provider value={control}>
      <AdvisorRuntimeContext.Provider value={runtime}>
        {children}
      </AdvisorRuntimeContext.Provider>
    </AdvisorControlContext.Provider>
  );
}

export function useAdvisor() {
  const context = useContext(AdvisorControlContext);
  if (context === undefined) {
    throw new Error('useAdvisor must be used within an AdvisorProvider');
  }
  return context;
}

export function useAdvisorRuntime() {
  const context = useContext(AdvisorRuntimeContext);
  if (context === undefined) {
    throw new Error('useAdvisorRuntime must be used within an AdvisorProvider');
  }
  return context;
}
