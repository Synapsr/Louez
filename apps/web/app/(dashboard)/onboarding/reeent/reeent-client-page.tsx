"use client";

import { Building2, User } from "lucide-react";
import { useTranslations } from "next-intl";

import { Badge, Button, Label, Radio, RadioGroup } from "@louez/ui";
import { ArrowLeftIcon, CheckIcon } from "@louez/ui/icons";
import { cn } from "@louez/utils";

import { DashboardIconTile } from "@/components/dashboard/shared/dashboard-icon-tile";
import { reeentRichTags } from "@/components/shared/reeent-wordmark";

import { OnboardingStepHeader } from "../_components/step-header";
import { useReeentIntro } from "../_lib/reeent-intro-context";
import { useReeentIntroSlides } from "../_lib/use-reeent-intro-slides";
import { useReeentIntroStep } from "./use-reeent-intro-step";

const STATUS_LABEL_ID = "reeent-intro-status-label";

const STATUS_OPTIONS = [
  { value: "professional", icon: Building2 },
  { value: "individual", icon: User },
] as const;

/**
 * The step people reeent sends over land on. The explanations come first, one
 * screen at a time — ADR 010 asks for them to be displayed, not merely
 * available — then the single pro/particulier question.
 */
export function ReeentClientPage() {
  const t = useTranslations("onboarding.reeent");
  const tCommon = useTranslations("common");
  const slides = useReeentIntroSlides();
  const { status, selectStatus, phase, goToPhase } = useReeentIntro();
  const { submit, isPending } = useReeentIntroStep();

  const slide = slides[phase];

  if (slide) {
    return (
      <>
        <OnboardingStepHeader
          title={t.rich("title", reeentRichTags)}
          description={t("introDescription")}
        />

        <div className="bg-muted/40 flex min-h-40 flex-col gap-3 rounded-xl p-5">
          <DashboardIconTile icon={slide.icon} accent={slide.accent} />
          <div className="space-y-1.5">
            <p className="text-sm font-medium">{slide.title}</p>

            {slide.amount && (
              <div>
                <p>
                  <span className="text-2xl font-semibold tracking-tight">
                    {slide.amount.value}
                  </span>{" "}
                  <span className="text-muted-foreground text-sm">{slide.amount.unit}</span>
                </p>
                <p className="text-muted-foreground text-sm">{slide.amount.detail}</p>
              </div>
            )}

            {slide.body && (
              <p className="text-muted-foreground text-sm leading-relaxed">{slide.body}</p>
            )}

            {slide.bullets && (
              <ul className="space-y-2 pt-1">
                {slide.bullets.map((bullet) => (
                  <li key={bullet} className="flex items-start gap-2">
                    <CheckIcon className="text-badge-success-foreground mt-0.5 size-4 shrink-0" />
                    <span className="text-muted-foreground text-sm leading-relaxed">{bullet}</span>
                  </li>
                ))}
              </ul>
            )}

            {slide.badge && <Badge variant="success">{slide.badge}</Badge>}

            {slide.note && (
              <p className="text-muted-foreground pt-1 text-xs leading-relaxed">{slide.note}</p>
            )}
          </div>
        </div>

        <div className="mt-6 flex items-center gap-3">
          {phase > 0 && (
            <Button
              variant="ghost"
              size="icon"
              aria-label={tCommon("previous")}
              onClick={() => goToPhase(phase - 1)}
            >
              <ArrowLeftIcon className="size-4" />
            </Button>
          )}
          <Button className="flex-1" onClick={() => goToPhase(phase + 1)}>
            {tCommon("next")}
          </Button>
        </div>

        <div
          role="progressbar"
          aria-valuemin={1}
          aria-valuemax={slides.length}
          aria-valuenow={phase + 1}
          aria-label={t("introDescription")}
          className="mt-4 flex items-center justify-center gap-1.5"
        >
          {slides.map((item, index) => (
            <span
              key={item.key}
              className={cn(
                "h-1.5 rounded-full transition-all duration-300",
                index === phase ? "bg-foreground w-6" : "bg-border w-1.5",
              )}
            />
          ))}
        </div>
      </>
    );
  }

  return (
    <>
      <OnboardingStepHeader
        title={t.rich("title", reeentRichTags)}
        description={t("description")}
      />

      <section className="space-y-2">
        <p id={STATUS_LABEL_ID} className="text-sm font-medium">
          {t("status.label")}
        </p>
        <RadioGroup
          aria-labelledby={STATUS_LABEL_ID}
          className="space-y-2"
          value={status}
          onValueChange={selectStatus}
        >
          {STATUS_OPTIONS.map(({ value, icon }) => (
            <Label
              key={value}
              className="hover:bg-accent/30 has-data-checked:border-foreground/30 has-data-checked:bg-accent/50 flex cursor-pointer items-start gap-3 rounded-xl border p-4 transition-colors"
            >
              <Radio value={value} className="hidden" />
              <DashboardIconTile icon={icon} />
              <div className="space-y-1">
                <p className="text-sm font-medium">{t(`status.${value}`)}</p>
                <p className="text-muted-foreground text-sm">{t(`status.${value}Hint`)}</p>
              </div>
            </Label>
          ))}
        </RadioGroup>
        <p className="text-muted-foreground text-sm">{t("status.hint")}</p>
      </section>

      <div className="mt-6 flex items-center gap-3">
        <Button variant="ghost" disabled={isPending} onClick={() => goToPhase(slides.length - 1)}>
          <ArrowLeftIcon className="size-4" />
          {tCommon("back")}
        </Button>
        <Button className="flex-1" disabled={isPending || !status} onClick={submit}>
          {tCommon("next")}
        </Button>
      </div>
    </>
  );
}
