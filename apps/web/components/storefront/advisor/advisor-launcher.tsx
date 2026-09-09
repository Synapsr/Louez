"use client";

import { MessageCircleQuestionIcon } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@louez/ui";
import { cn } from "@louez/utils";

interface AdvisorLauncherProps {
  isOpen: boolean;
  onClick: () => void;
}

/**
 * The one floating element of the storefront: bottom-right, above the home
 * indicator, lifted over a sticky action bar when a page has one.
 */
export const AdvisorLauncher = ({ isOpen, onClick }: AdvisorLauncherProps) => {
  const t = useTranslations("storefront.advisor");

  return (
    <Button
      type="button"
      size="icon-xl"
      onClick={onClick}
      aria-label={t("open")}
      className={cn(
        "fixed right-4 bottom-[calc(env(safe-area-inset-bottom,0px)+--spacing(4))] z-40 size-14 rounded-full shadow-raised",
        "[body:has([data-slot=sticky-action-bar])_&]:bottom-[calc(env(safe-area-inset-bottom,0px)+--spacing(24))] lg:[body:has([data-slot=sticky-action-bar])_&]:bottom-4",
        "transition-[opacity,transform] duration-200 motion-safe:hover:scale-105 motion-safe:active:scale-95",
        isOpen && "pointer-events-none scale-90 opacity-0",
      )}
    >
      <MessageCircleQuestionIcon className="size-6" />
    </Button>
  );
};
