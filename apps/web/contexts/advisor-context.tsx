"use client";

import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { useChat } from "@ai-sdk/react";
import type { UIMessage } from "@ai-sdk/react";
import { useQuery } from "@tanstack/react-query";
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithToolCalls } from "ai";

import type { AdvisorCartSnapshot } from "@louez/validations";

import { useCartActions, useCartState } from "@/contexts/cart-context";
import { VERIFICATION_KICKOFF_PROMPT, isVerificationKickoff } from "@/lib/ai/advisor/kickoff";
import {
  findCartPeriodConflict,
  parseAdvisorAddToCartInput,
  toAdvisorCartLine,
} from "@/lib/ai/advisor/util.add-to-cart";
import { resolveRequiredAccessories } from "@/lib/ai/advisor/util.resolve-required-accessories";
import { orpcClient } from "@/lib/orpc";
import { storefrontQueries } from "@/lib/queries/storefront.queries";

/**
 * Why the widget was opened. 'checkout' surfaces the reservation-validation
 * suggestion chip (required/recommended modes).
 */
export type AdvisorIntent = "checkout" | null;

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
  open: (options?: { intent?: "checkout" }) => void;
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

const AdvisorControlContext = createContext<AdvisorControlValue | undefined>(undefined);
const AdvisorRuntimeContext = createContext<AdvisorRuntimeValue | undefined>(undefined);

const storageKey = (storeSlug: string) => `louez_advisor_${storeSlug}`;

/** Strict ISO 8601 (with offset) or undefined — never an invalid string. */
const toStrictIso = (value: string | null): string | undefined => {
  if (!value) return undefined;
  const time = Date.parse(value);
  return Number.isNaN(time) ? undefined : new Date(time).toISOString();
};

/** The `record_qualification` tool answered and validated the conversation. */
const isValidatedQualification = (part: UIMessage["parts"][number]): boolean => {
  if (part.type !== "tool-record_qualification" || part.state !== "output-available") {
    return false;
  }
  const output: unknown = part.output;
  return (
    typeof output === "object" &&
    output !== null &&
    "validated" in output &&
    output.validated === true
  );
};

interface AdvisorProviderProps {
  children: ReactNode;
  storeSlug: string;
  enabled: boolean;
  displayName?: string;
  welcomeMessage?: string;
}

export const AdvisorProvider = ({
  children,
  storeSlug,
  enabled,
  displayName,
  welcomeMessage,
}: AdvisorProviderProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [intent, setIntent] = useState<AdvisorIntent>(null);
  const [conversationId, setConversationIdState] = useState<string | null>(null);
  const [validationVersion, setValidationVersion] = useState(0);
  const [inlineActive, setInlineActive] = useState(false);
  // False until localStorage has been read: gates the hydration query and
  // the checkout auto-start so neither races the stored conversation id.
  const [storageRead, setStorageRead] = useState(false);
  // Conversation whose transcript is already in `useChat` (fetched, or
  // written locally), so the hydration query does not run for it.
  const [hydratedConversationId, setHydratedConversationId] = useState<string | null>(null);

  const cartState = useCartState();
  const { addItem } = useCartActions();

  useEffect(() => {
    try {
      setConversationIdState(localStorage.getItem(storageKey(storeSlug)));
    } catch {
      // Storage unavailable — the conversation just won't persist
    }
    setStorageRead(true);
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
    (options?: { intent?: "checkout" }) => {
      if (!enabled) return;
      if (options?.intent) setIntent(options.intent);
      setIsOpen(true);
    },
    [enabled],
  );

  const close = useCallback(() => setIsOpen(false), []);
  const clearIntent = useCallback(() => setIntent(null), []);
  const notifyValidated = useCallback(() => setValidationVersion((version) => version + 1), []);

  // Latest state via refs: the transport body and tool handler run outside the
  // render cycle and must never see stale closures.
  const conversationIdRef = useRef<string | null>(conversationId);
  conversationIdRef.current = conversationId;

  const cartStateRef = useRef(cartState);
  cartStateRef.current = cartState;

  // Capture the conversation id issued by the API on first message.
  const customFetch = useCallback(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const res = await fetch(input, init);
      const newConversationId = res.headers.get("X-Conversation-Id");
      if (newConversationId && newConversationId !== conversationIdRef.current) {
        setConversationId(newConversationId);
      }
      return res;
    },
    [setConversationId],
  );

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/storefront/chat",
        headers: () => ({ "x-store-slug": storeSlug }),
        body: (): { conversationId: string | undefined; cart: AdvisorCartSnapshot } => {
          const currentCart = cartStateRef.current;
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
      const parsed = parseAdvisorAddToCartInput(rawInput);
      if (!parsed.ok) {
        return { success: false as const, reason: parsed.reason };
      }
      const { request } = parsed;
      const currentCart = cartStateRef.current;

      const conflict = findCartPeriodConflict(
        {
          hasItems: currentCart.items.length > 0,
          startDate: currentCart.globalStartDate,
          endDate: currentCart.globalEndDate,
        },
        request,
      );
      if (conflict) {
        return { success: false as const, reason: "date_conflict", ...conflict };
      }

      try {
        const resolved = await orpcClient.storefront.cart.resolve({
          lines: [{ lineId: "advisor-add", ...request }],
        });
        const line = resolved.lines[0];
        if (!line || line.status !== "resolved") {
          return {
            success: false as const,
            reason: line?.status === "unavailable" ? line.reason : "unavailable",
          };
        }

        // Required accessories travel with the product: resolve them through
        // the same endpoint so their price and stock are server-authoritative.
        const requiredAccessories =
          line.requiredAccessories.length > 0
            ? await resolveRequiredAccessories({
                requiredAccessories: line.requiredAccessories,
                parentQuantity: request.quantity,
                startDate: request.startDate,
                endDate: request.endDate,
              })
            : [];

        // The period travels with the line: an empty cart adopts it, a cart
        // with the same period keeps it (the conflict check ran above).
        addItem(toAdvisorCartLine(line, request, requiredAccessories));

        return {
          success: true as const,
          productName: line.productName,
          // addItem merges same-product lines and caps at availability — tell
          // the model so it never overstates what is in the cart.
          requestedQuantity: request.quantity,
          maxAvailableQuantity: line.maxQuantity,
        };
      } catch {
        return { success: false as const, reason: "error" };
      }
    },
    [addItem],
  );

  const { messages, sendMessage, status, setMessages, error, clearError, addToolResult } = useChat({
    transport,
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
    async onToolCall({ toolCall }) {
      if (toolCall.toolName === "add_to_cart") {
        const output = await handleAddToCart(toolCall.input);
        addToolResult({
          tool: "add_to_cart",
          toolCallId: toolCall.toolCallId,
          output,
        });
      }
    },
  });

  const messagesRef = useRef(messages);
  messagesRef.current = messages;

  // Rehydrate the thread after a page reload: the conversation id survives in
  // localStorage but useChat state does not. Inert when the advisor is off so
  // a disabled store fires no chat network calls, and skipped when the thread
  // already holds messages (an id issued mid-conversation).
  const needsHydration =
    enabled &&
    storageRead &&
    conversationId !== null &&
    hydratedConversationId !== conversationId &&
    messages.length === 0;

  const storedMessagesQuery = useQuery({
    ...storefrontQueries.advisorMessages(conversationId ?? ""),
    enabled: needsHydration,
    retry: false,
  });

  useEffect(() => {
    if (!needsHydration || conversationId === null) return;

    if (storedMessagesQuery.isSuccess) {
      const stored = storedMessagesQuery.data.messages;
      if (stored.length > 0 && messagesRef.current.length === 0) {
        setMessages(
          stored.map((message) => ({
            id: message.id,
            role: message.role,
            parts: [{ type: "text" as const, text: message.content }],
          })),
        );
      }
      setHydratedConversationId(conversationId);
      return;
    }

    // A stale/unknown id resets to a fresh conversation instead of erroring.
    if (storedMessagesQuery.isError) {
      setConversationId(null);
    }
  }, [
    needsHydration,
    conversationId,
    storedMessagesQuery.isSuccess,
    storedMessagesQuery.isError,
    storedMessagesQuery.data,
    setMessages,
    setConversationId,
  ]);

  const isHydrating = !storageRead || (needsHydration && storedMessagesQuery.isPending);

  // Surface advisor validation to the checkout gate (record_qualification tool
  // output with validated=true). This is the trigger that flips the inline
  // verification panel and the confirm button to the validated state.
  const notifiedValidationsRef = useRef(new Set<string>());
  useEffect(() => {
    for (const message of messages) {
      for (const part of message.parts) {
        if (
          isValidatedQualification(part) &&
          "toolCallId" in part &&
          !notifiedValidationsRef.current.has(part.toolCallId)
        ) {
          notifiedValidationsRef.current.add(part.toolCallId);
          notifyValidated();
        }
      }
    }
  }, [messages, notifyValidated]);

  const isLoading = status === "submitted" || status === "streaming";

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
    setHydratedConversationId(null);
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
      isHydrating,
      hasError: Boolean(error),
      errorCode: error?.message?.trim() ?? "",
      send,
      startVerification,
      restart,
      displayName,
      welcomeMessage,
    }),
    [
      messages,
      isLoading,
      isHydrating,
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
      <AdvisorRuntimeContext.Provider value={runtime}>{children}</AdvisorRuntimeContext.Provider>
    </AdvisorControlContext.Provider>
  );
};

export const useAdvisor = (): AdvisorControlValue => {
  const context = useContext(AdvisorControlContext);
  if (context === undefined) {
    throw new Error("useAdvisor must be used within an AdvisorProvider");
  }
  return context;
};

export const useAdvisorRuntime = (): AdvisorRuntimeValue => {
  const context = useContext(AdvisorRuntimeContext);
  if (context === undefined) {
    throw new Error("useAdvisorRuntime must be used within an AdvisorProvider");
  }
  return context;
};
