"use client";

import { useState } from "react";

import { Handshake, X } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button, Collapsible, CollapsiblePanel, CollapsibleTrigger, Input } from "@louez/ui";

import type { useCheckoutPartner } from "../hooks/use-checkout-partner";

interface CheckoutPartnerCodeProps {
  partner: ReturnType<typeof useCheckoutPartner>;
}

/**
 * "A partner recommended us?": the customer types the code a campsite or a
 * hotel gave them, and the booking is credited to that partner.
 */
export const CheckoutPartnerCode = ({ partner }: CheckoutPartnerCodeProps) => {
  const t = useTranslations("storefront.checkout.partnerCode");
  const [code, setCode] = useState("");

  if (partner.typed) {
    return (
      <div className="bg-muted/50 flex items-center justify-between gap-3 rounded-lg px-3 py-2 text-sm">
        <div className="flex min-w-0 items-center gap-2">
          <Handshake aria-hidden className="text-muted-foreground size-4 shrink-0" />
          <span className="truncate">{t("credited", { partner: partner.typed.name })}</span>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={partner.remove}
          aria-label={t("remove")}
        >
          <X />
        </Button>
      </div>
    );
  }

  const submit = () => partner.check(code);

  return (
    <Collapsible>
      <CollapsibleTrigger className="text-muted-foreground hover:text-foreground flex items-center gap-1.5 text-sm transition-colors duration-200">
        <Handshake aria-hidden className="size-4" />
        {t("question")}
      </CollapsibleTrigger>
      <CollapsiblePanel>
        <div className="flex flex-col gap-2 pt-3">
          <div className="flex gap-2">
            <Input
              placeholder={t("placeholder")}
              value={code}
              autoCapitalize="none"
              autoCorrect="off"
              aria-label={t("placeholder")}
              onChange={(event) => {
                setCode(event.target.value);
                if (partner.issue) partner.clearIssue();
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  submit();
                }
              }}
              className="flex-1"
              disabled={partner.isChecking}
            />
            <Button
              type="button"
              variant="outline"
              onClick={submit}
              isPending={partner.isChecking}
              disabled={!code.trim()}
              className="shrink-0"
            >
              {t("apply")}
            </Button>
          </div>
          {partner.issue && <p className="text-destructive text-xs">{t(partner.issue)}</p>}
        </div>
      </CollapsiblePanel>
    </Collapsible>
  );
};
