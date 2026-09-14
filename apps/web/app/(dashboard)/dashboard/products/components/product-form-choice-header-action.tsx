"use client";

import { Pencil } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@louez/ui";

import type { ChoiceStep } from "../hooks/use-choice-step";

interface ProductFormChoiceHeaderActionProps {
  step: ChoiceStep;
  /** The option currently applied, shown as the button's text. */
  choice: string;
  disabled?: boolean;
}

/**
 * The folded form of a card-choice step, in the card header: the answer, which
 * reopens the cards. While they are open again, the same spot cancels.
 */
export const ProductFormChoiceHeaderAction = ({
  step,
  choice,
  disabled,
}: ProductFormChoiceHeaderActionProps) => {
  const t = useTranslations("dashboard.products.form");

  if (step.isChoosing) {
    if (!step.isAnswered) return null;
    return (
      <Button key="cancel" type="button" variant="ghost" size="sm" onClick={step.cancel}>
        {t("unitTracking.cancel")}
      </Button>
    );
  }

  // Distinct keys: the two buttons share a position, and a reused Button would
  // play its end-icon exit animation, leaving the pencil floating beside "Cancel".
  return (
    <Button
      key="change"
      type="button"
      variant="outline"
      size="sm"
      onClick={step.reopen}
      disabled={disabled}
      aria-label={t("choiceChange", { choice })}
    >
      {choice}
      <Pencil data-slot="icon" className="text-muted-foreground" />
    </Button>
  );
};
