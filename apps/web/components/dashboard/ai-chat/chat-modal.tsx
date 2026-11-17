"use client";

import { useState } from "react";
import type { MouseEvent } from "react";

import { History, Maximize2, PenSquare, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import {
  Button,
  Dialog,
  DialogClose,
  DialogPopup,
  DialogTitle,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@louez/ui";
import { cn } from "@louez/utils";

import { ChatEmptyState } from "./chat-empty-state";
import { ChatErrorBanner } from "./chat-error-banner";
import { ChatHistory } from "./chat-history";
import { ChatInput } from "./chat-input";
import { ChatMessages } from "./chat-messages";
import { useDashboardChat } from "./use-dashboard-chat";
import { useStickToBottom } from "./use-stick-to-bottom";

interface ChatModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * The copilot behind Cmd+Shift+K — the same chat as `/dashboard/ai-assistant`
 * in a dialog, down to the shared empty state, chips and composer. Only the
 * chrome differs, so the two surfaces can never drift apart visually.
 */
export const ChatModal = ({ open, onOpenChange }: ChatModalProps) => {
  const t = useTranslations("dashboard.aiChat");
  const router = useRouter();
  const [historyOpen, setHistoryOpen] = useState(false);

  const {
    messages,
    isLoading,
    continueApproval,
    followUpIds,
    chatId,
    historyRef,
    errorMessage,
    isLimitError,
    startNewChat,
    selectChat,
    send,
  } = useDashboardChat();

  const { scrollRef, onScroll } = useStickToBottom(messages);

  const handleOpenFullPage = () => {
    onOpenChange(false);
    router.push("/dashboard/ai-assistant");
  };

  // Answers link to reservations, customers and products. Following one
  // navigates the page underneath, so the dialog has to step aside — staying
  // open would cover the very record the merchant asked to see.
  const handleContentClick = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target instanceof HTMLElement && event.target.closest("a")) {
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup
        showCloseButton={false}
        bottomStickOnMobile
        className={cn(
          "dashboard flex h-[min(80vh,720px)] w-full flex-col overflow-hidden",
          historyOpen ? "max-w-3xl" : "max-w-2xl",
          "transition-[max-width] duration-200",
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <DialogTitle className="truncate text-sm leading-none font-semibold">
              {t("title")}
            </DialogTitle>
            <p className="text-muted-foreground mt-1 truncate text-xs">{t("subtitle")}</p>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            <TooltipProvider>
              {/* Open as full page */}
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      className="text-muted-foreground hover:text-foreground"
                      onClick={handleOpenFullPage}
                      aria-label={t("openFullPage")}
                    />
                  }
                >
                  <Maximize2 className="size-3.5" />
                </TooltipTrigger>
                <TooltipContent>{t("openFullPage")}</TooltipContent>
              </Tooltip>

              {/* History toggle */}
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      className={cn(
                        "text-muted-foreground hover:text-foreground",
                        historyOpen && "bg-muted text-foreground",
                      )}
                      onClick={() => setHistoryOpen((prev) => !prev)}
                      aria-label={t("history.title")}
                    />
                  }
                >
                  <History className="size-3.5" />
                </TooltipTrigger>
                <TooltipContent>{t("history.title")}</TooltipContent>
              </Tooltip>

              {/* New conversation */}
              {messages.length > 0 && (
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        className="text-muted-foreground hover:text-foreground"
                        onClick={startNewChat}
                        aria-label={t("newConversation")}
                      />
                    }
                  >
                    <PenSquare className="size-3.5" />
                  </TooltipTrigger>
                  <TooltipContent>{t("newConversation")}</TooltipContent>
                </Tooltip>
              )}

              {/* Close */}
              <Tooltip>
                <TooltipTrigger
                  render={
                    <DialogClose
                      render={
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          className="text-muted-foreground hover:text-foreground"
                          aria-label={t("close")}
                        />
                      }
                    />
                  }
                >
                  <X className="size-3.5" />
                </TooltipTrigger>
                <TooltipContent>{t("close")}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        </div>

        {/* Body: sidebar + chat */}
        <div className="flex min-h-0 flex-1">
          {/* History sidebar */}
          <ChatHistory
            ref={historyRef}
            activeChatId={chatId}
            onSelectChat={selectChat}
            onNewChat={startNewChat}
            open={historyOpen}
          />

          {/* Chat area */}
          <div className="flex min-w-0 flex-1 flex-col">
            {/* Messages area — the only scroll container in the dialog */}
            <div
              ref={scrollRef}
              onScroll={onScroll}
              onClick={handleContentClick}
              className="min-h-0 flex-1 overflow-y-auto motion-safe:scroll-smooth"
            >
              <div className="flex min-h-full flex-col px-4 py-4 sm:px-5">
                {messages.length > 0 ? (
                  <ChatMessages
                    messages={messages}
                    isLoading={isLoading}
                    onApprovalContinue={continueApproval}
                    followUpIds={followUpIds}
                  />
                ) : (
                  <ChatEmptyState onPrompt={send} />
                )}
              </div>
            </div>

            {/* Error / rate limit banner */}
            {errorMessage && (
              <ChatErrorBanner
                message={errorMessage}
                isLimitError={isLimitError}
                onUpgradeNavigate={() => onOpenChange(false)}
                className="mx-4 mb-2"
              />
            )}

            {/* Input */}
            <ChatInput onSend={send} isLoading={isLoading} />
          </div>
        </div>
      </DialogPopup>
    </Dialog>
  );
};
