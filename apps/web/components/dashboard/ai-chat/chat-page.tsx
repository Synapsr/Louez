"use client";

import { useCallback, useState } from "react";

import { History, PenSquare } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button, Sheet, SheetPopup, SheetTitle } from "@louez/ui";

import { ChatEmptyState, type ChatDiscovery } from "./chat-empty-state";
import { ChatErrorBanner } from "./chat-error-banner";
import { ChatHistory } from "./chat-history";
import { ChatInput } from "./chat-input";
import { ChatMessages } from "./chat-messages";
import { useDashboardChat } from "./use-dashboard-chat";
import { useStickToBottom } from "./use-stick-to-bottom";

interface ChatPageProps {
  advisorDiscovery: ChatDiscovery;
  voiceDiscovery: ChatDiscovery;
}

/**
 * The merchant copilot as a full page — the ChatGPT-shaped sibling of the
 * Cmd+Shift+K modal, sharing its wiring (useDashboardChat) and thus its
 * history. Desktop shows a persistent history rail; below `lg` the rail
 * becomes a left sheet behind the header's history button.
 */
export const ChatPage = ({ advisorDiscovery, voiceDiscovery }: ChatPageProps) => {
  const t = useTranslations("dashboard.aiChat");
  const [mobileHistoryOpen, setMobileHistoryOpen] = useState(false);

  const {
    messages,
    isLoading,
    continueApproval,
    chatId,
    historyRef,
    errorMessage,
    isLimitError,
    startNewChat,
    selectChat,
    send,
  } = useDashboardChat();

  const { scrollRef, onScroll } = useStickToBottom(messages);

  const handleMobileSelectChat = useCallback(
    (id: string) => {
      selectChat(id);
      setMobileHistoryOpen(false);
    },
    [selectChat],
  );

  const handleMobileNewChat = useCallback(() => {
    startNewChat();
    setMobileHistoryOpen(false);
  }, [startNewChat]);

  const hasConversation = messages.length > 0;

  return (
    <div
      // Full bleed: the chat *is* the page surface, so it cancels the content
      // gutter (px-4 sm:px-6 lg:px-8 / py-4 pb-2 md:py-6) instead of sitting in
      // it as a card. The SidebarInset panel is already a rounded, bordered
      // frame — a second box inside it was chrome for nothing.
      // What the gutter leaves once cancelled:
      //   mobile — 3.5rem header
      //   md+    — 3.5rem header + 1rem SidebarInset m-2
      // svh, not dvh: the shell root is h-svh, so dvh would overflow it on
      // mobile browsers whose URL bar collapses.
      className="-mx-4 -mt-4 -mb-2 flex h-[calc(100svh-3.5rem)] overflow-hidden sm:-mx-6 md:-mt-6 md:-mb-6 md:h-[calc(100svh-4.5rem)] lg:-mx-8"
    >
      {/* Desktop history rail */}
      <div className="bg-muted/30 hidden w-64 shrink-0 border-r lg:block xl:w-72">
        <ChatHistory
          ref={historyRef}
          variant="page"
          activeChatId={chatId}
          onSelectChat={selectChat}
          onNewChat={startNewChat}
          open
        />
      </div>

      {/* Mobile history sheet */}
      <Sheet open={mobileHistoryOpen} onOpenChange={setMobileHistoryOpen}>
        <SheetPopup side="left" className="w-80 max-w-[85vw]">
          <SheetTitle className="border-b px-4 py-3.5 text-sm font-medium">
            {t("history.title")}
          </SheetTitle>
          <ChatHistory
            variant="page"
            activeChatId={chatId}
            onSelectChat={handleMobileSelectChat}
            onNewChat={handleMobileNewChat}
            open
            className="min-h-0 flex-1"
          />
        </SheetPopup>
      </Sheet>

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Phones only: the rail carries these two actions on desktop, and the
            shell breadcrumb already names the page — a title bar here would be
            the third "Assistant IA" on screen. */}
        <div className="flex h-12 shrink-0 items-center border-b px-2.5 lg:hidden">
          <Button
            variant="ghost"
            size="icon-sm"
            className="text-muted-foreground hover:text-foreground"
            onClick={() => setMobileHistoryOpen(true)}
            aria-label={t("history.title")}
          >
            <History className="size-4" />
          </Button>
          <div className="flex-1" />
          {hasConversation && (
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground hover:text-foreground"
              onClick={startNewChat}
              aria-label={t("newConversation")}
            >
              <PenSquare className="size-4" />
            </Button>
          )}
        </div>

        {/* Messages area — the only scroll container on the page */}
        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="min-h-0 flex-1 overflow-y-auto motion-safe:scroll-smooth"
        >
          <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col px-4 py-6 sm:px-6">
            {hasConversation ? (
              <ChatMessages
                messages={messages}
                isLoading={isLoading}
                onApprovalContinue={continueApproval}
              />
            ) : (
              <ChatEmptyState
                onPrompt={send}
                advisorDiscovery={advisorDiscovery}
                voiceDiscovery={voiceDiscovery}
              />
            )}
          </div>
        </div>

        {/* Error / rate limit banner */}
        {errorMessage && (
          <div className="mx-auto w-full max-w-3xl px-4 sm:px-6">
            <ChatErrorBanner message={errorMessage} isLimitError={isLimitError} className="mb-2" />
          </div>
        )}

        {/* Input pinned at the bottom */}
        <div className="mx-auto w-full max-w-3xl shrink-0 px-1 sm:px-3">
          <ChatInput onSend={send} isLoading={isLoading} className="mb-1.5" />
          <p className="text-muted-foreground pb-2.5 text-center text-xs">{t("disclaimer")}</p>
        </div>
      </div>
    </div>
  );
};
