"use client";

import { useEffect, useRef } from "react";

import type { UIMessage } from "@ai-sdk/react";
import { RotateCcwIcon, ShieldCheckIcon, SparklesIcon, XIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button, Sheet, SheetClose, SheetDescription, SheetPopup, SheetTitle } from "@louez/ui";
import { cn } from "@louez/utils";

import type { AdvisorIntent } from "@/contexts/advisor-context";

import { AdvisorInput } from "./advisor-input";
import { AdvisorMessages } from "./advisor-messages";

interface AdvisorPanelProps {
  isOpen: boolean;
  onClose: () => void;
  displayName?: string;
  welcomeMessage?: string;
  intent: AdvisorIntent;
  onIntentConsumed: () => void;
  messages: UIMessage[];
  isLoading: boolean;
  hasError: boolean;
  errorCode: string;
  onSend: (text: string) => void;
  onRestart: () => void;
}

const SUGGESTION_CLASS_NAME =
  "min-h-11 rounded-full border px-4 text-left text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:min-h-9";

/**
 * The advisor conversation, on the shared Sheet: full screen on phones,
 * a panel anchored bottom-right from `sm`. Focus, Escape and the backdrop
 * are the primitive's.
 */
export const AdvisorPanel = ({
  isOpen,
  onClose,
  displayName,
  welcomeMessage,
  intent,
  onIntentConsumed,
  messages,
  isLoading,
  hasError,
  errorCode,
  onSend,
  onRestart,
}: AdvisorPanelProps) => {
  const t = useTranslations("storefront.advisor");
  const scrollRef = useRef<HTMLDivElement>(null);

  // Follow the conversation: the thread is an external, growing list.
  useEffect(() => {
    const element = scrollRef.current;
    if (element && isOpen) {
      element.scrollTo({ top: element.scrollHeight, behavior: "smooth" });
    }
  }, [messages, isOpen]);

  const handleSuggestion = (text: string) => {
    onIntentConsumed();
    onSend(text);
  };

  const isRateLimited = errorCode.startsWith("rate_limit");
  const isUnavailable = errorCode === "credits_exhausted";
  const errorMessage = hasError
    ? isRateLimited
      ? t("errors.rateLimited")
      : isUnavailable
        ? t("errors.unavailable")
        : t("errors.generic")
    : null;

  const suggestions = [
    { key: "recommend", prompt: t("suggestions.recommend") },
    { key: "question", prompt: t("suggestions.question") },
    { key: "practical", prompt: t("suggestions.practical") },
  ] as const;

  return (
    <Sheet
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <SheetPopup
        side="right"
        variant="inset"
        showCloseButton={false}
        aria-label={displayName || t("title")}
        className="max-sm:w-full max-sm:max-w-none sm:h-[min(640px,100%)] sm:w-100 sm:self-end sm:shadow-overlay"
      >
        <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <div
              aria-hidden
              className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10"
            >
              <SparklesIcon className="size-4 text-primary" />
            </div>
            <div className="min-w-0">
              <SheetTitle className="truncate text-base leading-tight">
                {displayName || t("title")}
              </SheetTitle>
              <SheetDescription className="text-xs">{t("subtitle")}</SheetDescription>
            </div>
          </div>
          <div className="flex shrink-0 items-center">
            {messages.length > 0 ? (
              <Button
                variant="ghost"
                size="icon-lg"
                className="text-muted-foreground sm:size-9"
                onClick={onRestart}
                aria-label={t("restart")}
              >
                <RotateCcwIcon className="size-4" />
              </Button>
            ) : null}
            <SheetClose
              aria-label={t("close")}
              render={
                <Button
                  variant="ghost"
                  size="icon-lg"
                  className="text-muted-foreground sm:size-9"
                />
              }
            >
              <XIcon className="size-5" />
            </SheetClose>
          </div>
        </div>

        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          <AdvisorMessages
            messages={messages}
            isLoading={isLoading}
            welcomeText={welcomeMessage || t("welcome")}
          />

          {messages.length === 0 ? (
            <div className="mt-4 flex flex-col items-start gap-2">
              {intent === "checkout" ? (
                <button
                  type="button"
                  onClick={() => handleSuggestion(t("validateChip"))}
                  className={cn(
                    SUGGESTION_CLASS_NAME,
                    "flex items-center gap-2 border-primary/40 bg-primary/5 font-medium text-primary hover:bg-primary/10 hover:text-primary",
                  )}
                >
                  <ShieldCheckIcon aria-hidden className="size-4 shrink-0" />
                  {t("validateChip")}
                </button>
              ) : null}
              {suggestions.map((suggestion) => (
                <button
                  key={suggestion.key}
                  type="button"
                  onClick={() => handleSuggestion(suggestion.prompt)}
                  className={SUGGESTION_CLASS_NAME}
                >
                  {suggestion.prompt}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <div className="flex flex-col gap-2 border-t px-3 pt-3 pb-[calc(env(safe-area-inset-bottom,0px)+--spacing(2))]">
          {errorMessage ? (
            <p
              role="alert"
              className="rounded-lg bg-destructive/8 px-3 py-2 text-xs text-destructive"
            >
              {errorMessage}
            </p>
          ) : null}
          <AdvisorInput onSend={onSend} isLoading={isLoading} className="mx-0" />
          <p className="text-center text-xs text-muted-foreground">{t("disclaimer")}</p>
        </div>
      </SheetPopup>
    </Sheet>
  );
};
