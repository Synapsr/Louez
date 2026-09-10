"use client";

import { useState } from "react";

import { Tag, X } from "lucide-react";
import { useTranslations } from "next-intl";

import { Badge, Button, Collapsible, CollapsiblePanel, CollapsibleTrigger, Input } from "@louez/ui";

import { useFormatMoney } from "@/hooks/use-format-money";

import type { ValidatedPromo } from "../checkout.types";
import type { PromoValidationError } from "../hooks/use-checkout-promo";

interface CheckoutPromoCodeProps {
  promo: ValidatedPromo | null;
  discountAmount: number;
  isValidating: boolean;
  validationError: PromoValidationError | null;
  onValidate: (code: string) => void;
  onRemove: () => void;
  onClearError: () => void;
}

export const CheckoutPromoCode = ({
  promo,
  discountAmount,
  isValidating,
  validationError,
  onValidate,
  onRemove,
  onClearError,
}: CheckoutPromoCodeProps) => {
  const t = useTranslations("storefront.checkout.promoCode");
  const tErrors = useTranslations("errors");
  const formatMoney = useFormatMoney();
  const [code, setCode] = useState("");

  // Validation keys come from the server as `errors.{errorType}`, so they
  // resolve against the shared `errors` namespace, not this component's.
  const errorMessage = validationError
    ? validationError.key.startsWith("errors.")
      ? tErrors(validationError.key.slice("errors.".length), validationError.params)
      : tErrors("generic")
    : null;

  if (promo) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-lg bg-success/12 px-3 py-2 text-sm text-success">
        <div className="flex min-w-0 items-center gap-2">
          <Tag aria-hidden className="size-4 shrink-0" />
          <Badge variant="promo">{promo.code}</Badge>
          <span className="font-medium tabular-nums">-{formatMoney(discountAmount)}</span>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={onRemove}
          aria-label={t("remove")}
          className="text-success hover:text-success"
        >
          <X />
        </Button>
      </div>
    );
  }

  const submit = () => {
    if (code.trim()) onValidate(code);
  };

  return (
    <Collapsible>
      <CollapsibleTrigger className="flex items-center gap-1.5 text-sm text-muted-foreground transition-colors duration-200 hover:text-foreground">
        <Tag aria-hidden className="size-4" />
        {t("haveCode")}
      </CollapsibleTrigger>
      <CollapsiblePanel>
        <div className="flex flex-col gap-2 pt-3">
          <div className="flex gap-2">
            <Input
              placeholder={t("placeholder")}
              value={code}
              autoCapitalize="characters"
              autoCorrect="off"
              aria-label={t("placeholder")}
              onChange={(event) => {
                setCode(event.target.value.toUpperCase());
                if (validationError) onClearError();
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  submit();
                }
              }}
              className="flex-1 font-mono uppercase"
              disabled={isValidating}
            />
            <Button
              type="button"
              variant="outline"
              onClick={submit}
              isPending={isValidating}
              disabled={!code.trim()}
              className="shrink-0"
            >
              {t("apply")}
            </Button>
          </div>
          {errorMessage && <p className="text-xs text-destructive">{errorMessage}</p>}
        </div>
      </CollapsiblePanel>
    </Collapsible>
  );
};
