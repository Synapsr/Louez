"use client";

import { useTranslations } from "next-intl";

import { CheckIcon } from "@louez/ui/icons";
import { cn } from "@louez/utils";

import { useReeentIntro } from "../_lib/reeent-intro-context";
import { useReeentIntroSlides } from "../_lib/use-reeent-intro-slides";

/**
 * Right-column companion of the reeent education step: the step walks through
 * the explanations one at a time, this says how many are left and which ones
 * are already behind. It is the shell's aside, so it is hidden below `lg` —
 * nothing here is content, the step itself carries all of it.
 */
export const ReeentIntroPanel = () => {
  const t = useTranslations("onboarding.reeent.panel");
  const slides = useReeentIntroSlides();
  const { phase } = useReeentIntro();

  return (
    <div className="animate-in fade-in slide-in-from-bottom-2 space-y-4 duration-500">
      <h2 className="text-muted-foreground text-xs font-medium tracking-wider uppercase">
        {t("title")}
      </h2>

      <ol className="space-y-3">
        {slides.map((slide, index) => {
          const isRead = index < phase;
          const isCurrent = index === phase;

          return (
            <li
              key={slide.key}
              aria-current={isCurrent ? "step" : undefined}
              className={cn(
                "flex items-center gap-3 rounded-xl border p-4 transition-colors",
                isCurrent && "border-foreground/30 bg-accent/40",
                !isCurrent && !isRead && "opacity-50",
              )}
            >
              <span
                aria-hidden="true"
                className={cn(
                  "flex size-6 shrink-0 items-center justify-center rounded-full border text-xs tabular-nums",
                  isRead &&
                    "bg-badge-success-background text-badge-success-foreground border-transparent",
                )}
              >
                {isRead ? <CheckIcon className="size-3.5" /> : index + 1}
              </span>
              <p className="text-sm font-medium">{slide.title}</p>
            </li>
          );
        })}
      </ol>
    </div>
  );
};
