"use client";

import { useRef, useState } from "react";
import type { KeyboardEvent } from "react";

import { ArrowUpIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@louez/ui";
import { cn } from "@louez/utils";
import { AI_ADVISOR_MESSAGE_MAX_LENGTH } from "@louez/validations";

interface AdvisorInputProps {
  onSend: (text: string) => void;
  isLoading: boolean;
  /** Overrides the default horizontal margin (floating panel vs inline). */
  className?: string;
  /** Overrides the default placeholder/aria-label (e.g. verification context). */
  placeholder?: string;
  /** One-shot attention pulse to draw the eye to the composer. */
  highlight?: boolean;
}

/** Composer of the advisor: `text-base` on phones so iOS does not zoom in. */
export const AdvisorInput = ({
  onSend,
  isLoading,
  className,
  placeholder,
  highlight = false,
}: AdvisorInputProps) => {
  const t = useTranslations("storefront.advisor");
  const [input, setInput] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleSend = () => {
    if (!input.trim() || isLoading) return;
    onSend(input.trim());
    setInput("");
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  };

  const hasInput = input.trim().length > 0;

  return (
    <div
      className={cn(
        "flex items-end gap-2 rounded-lg border bg-background px-3 py-1.5",
        "transition-[border-color,box-shadow] duration-200 focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/30",
        highlight && "animate-attention-pulse",
        className ?? "mx-3",
      )}
    >
      <textarea
        ref={textareaRef}
        value={input}
        onChange={(event) => setInput(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder ?? t("placeholder")}
        aria-label={placeholder ?? t("placeholder")}
        // readOnly (not disabled) while loading keeps the field focusable, so
        // focus and the mobile keyboard survive between turns.
        readOnly={isLoading}
        aria-disabled={isLoading}
        maxLength={AI_ADVISOR_MESSAGE_MAX_LENGTH}
        rows={1}
        className={cn(
          "field-sizing-content max-h-25 min-h-9 flex-1 resize-none bg-transparent py-1.5 text-base outline-none placeholder:text-muted-foreground sm:text-sm",
          isLoading && "opacity-50",
        )}
      />
      <Button
        type="button"
        size="icon-lg"
        aria-label={t("send")}
        className="mb-0.5 shrink-0 sm:size-9"
        disabled={!hasInput || isLoading}
        onClick={handleSend}
      >
        <ArrowUpIcon className="size-4" />
      </Button>
    </div>
  );
};
