"use client";

import { useCallback, useMemo, useRef, useState, useTransition } from "react";

import { useChat } from "@ai-sdk/react";
import type { UIMessage } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useTranslations } from "next-intl";

import { loadChatMessages } from "@/app/(dashboard)/dashboard/ai-chat-actions";
import { approvalFollowUp, type ApprovalCard } from "@/lib/ai/approval-card";

import type { ChatHistoryHandle } from "./chat-history";

/** Error codes returned by the API route */
const RATE_LIMIT_CODES = new Set(["rate_limit:minute", "rate_limit:hour", "rate_limit:day"]);

/**
 * The dashboard copilot's client wiring, shared by the Cmd+Shift+K modal and
 * the full-page chat: one `useChat` whose transport sends the current
 * conversation id, intercepts the `X-Chat-Id` the API mints for brand-new
 * conversations, loads stored conversations back into UI messages, and maps
 * the API's error codes to translated copy. Both surfaces read and write the
 * same history — only the chrome around this hook differs.
 */
export const useDashboardChat = () => {
  const t = useTranslations("dashboard.aiChat");

  const [chatId, setChatId] = useState<string | null>(null);
  const chatIdRef = useRef<string | null>(null);
  const historyRef = useRef<ChatHistoryHandle>(null);
  const [, startTransition] = useTransition();

  // Custom fetch to intercept the X-Chat-Id header from the API response
  const customFetch = useCallback(async (input: RequestInfo | URL, init?: RequestInit) => {
    const res = await fetch(input, init);
    const newChatId = res.headers.get("X-Chat-Id");
    if (newChatId && newChatId !== chatIdRef.current) {
      chatIdRef.current = newChatId;
      setChatId(newChatId);
      // Refresh the history sidebar so the new conversation appears
      historyRef.current?.refresh();
    }
    return res;
  }, []);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        body: () => (chatIdRef.current ? { chatId: chatIdRef.current } : {}),
        fetch: customFetch,
      }),
    [customFetch],
  );

  const { messages, sendMessage, status, setMessages, error, clearError } = useChat({ transport });

  const isLoading = status === "submitted" || status === "streaming";

  // Parse the error code from the SDK error message
  const errorCode = error?.message?.trim() ?? "";
  const isUpgradeRequired = errorCode === "upgrade_required";
  const isRateLimited = RATE_LIMIT_CODES.has(errorCode);

  // Resolve the translated error message
  const errorMessage = error
    ? isUpgradeRequired
      ? t("limits.upgradeRequired")
      : isRateLimited
        ? t(`limits.${errorCode.replace(":", "_")}` as Parameters<typeof t>[0])
        : t("error")
    : null;

  const startNewChat = useCallback(() => {
    chatIdRef.current = null;
    setChatId(null);
    setMessages([]);
    clearError();
  }, [setMessages, clearError]);

  const selectChat = useCallback(
    (selectedChatId: string) => {
      if (selectedChatId === chatId) return;

      startTransition(async () => {
        const result = await loadChatMessages(selectedChatId);
        if (result.error || !result.messages.length) return;

        // Convert DB messages to UIMessage format
        const uiMessages: UIMessage[] = result.messages
          .filter((m) => m.role === "user" || m.role === "assistant")
          .map((m) => ({
            id: m.id,
            role: m.role as "user" | "assistant",
            content: m.content,
            parts: [{ type: "text" as const, text: m.content }],
            createdAt: m.createdAt,
          }));

        chatIdRef.current = selectedChatId;
        setChatId(selectedChatId);
        setMessages(uiMessages);
        clearError();
      });
    },
    [chatId, setMessages, clearError],
  );

  const send = useCallback(
    (text: string) => {
      if (!text.trim() || isLoading) return;
      clearError();
      sendMessage({ text });
    },
    [isLoading, clearError, sendMessage],
  );

  // The approvals whose follow-up this chat sent: once each, on its own.
  const continuedRef = useRef(new Set<string>());

  /**
   * Once the person approved a payment the assistant prepared (on its page,
   * read by the card), the turn that lets the model carry it out: sent once
   * per approval, and never while an answer streams (the card asks again
   * when it ends). The person's own click (`manual`) sends it again: the
   * procedure carries an approval out once, and answers `used` after.
   */
  const continueApproval = useCallback(
    (card: ApprovalCard, options: { manual?: boolean } = {}) => {
      if (isLoading) return;
      if (!options.manual && continuedRef.current.has(card.approvalId)) return;
      continuedRef.current.add(card.approvalId);
      clearError();
      sendMessage({ text: approvalFollowUp(card) });
    },
    [isLoading, clearError, sendMessage],
  );

  return {
    messages,
    isLoading,
    chatId,
    /** Attach to the ChatHistory that must refresh when a chat is created. */
    historyRef,
    errorMessage,
    /** Limit-shaped errors (rate limit / plan gate): softer banner + upgrade CTA. */
    isLimitError: isUpgradeRequired || isRateLimited,
    startNewChat,
    selectChat,
    send,
    continueApproval,
  };
};
