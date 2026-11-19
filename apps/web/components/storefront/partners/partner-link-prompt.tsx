"use client";

import { useState } from "react";

import { useMutation } from "@tanstack/react-query";
import { Handshake } from "lucide-react";
import { useTranslations } from "next-intl";

import { PARTNER_LINK_PARAM } from "@louez/api/contracts/partners";
import { Button } from "@louez/ui";

interface PartnerLinkPromptProps {
  storeId: string;
  code: string;
  partnerName: string;
}

/** The link's partner parameter, taken out of the address bar once answered: a reload asks nothing. */
const dropPartnerParam = () => {
  const url = new URL(window.location.href);
  url.searchParams.delete(PARTNER_LINK_PARAM);
  window.history.replaceState(window.history.state, "", url.toString());
};

/** The customer's yes: the storefront sets its partner cookie (app/api/storefront/partner-consent). */
const acceptPartnerLink = async (storeId: string, code: string): Promise<void> => {
  const response = await fetch("/api/storefront/partner-consent", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ storeId, code }),
  });
  if (!response.ok) throw new Error(`partner consent refused: ${response.status}`);
};

/**
 * Asks a customer who came by a partner's link whether to credit that partner
 * for their booking. Only a "yes" stores anything (an affiliation cookie needs
 * consent); the price never changes.
 */
export const PartnerLinkPrompt = ({ storeId, code, partnerName }: PartnerLinkPromptProps) => {
  const t = useTranslations("storefront.partnerLink");
  const [answered, setAnswered] = useState(false);
  const accept = useMutation({
    mutationFn: () => acceptPartnerLink(storeId, code),
    onSettled: () => {
      dropPartnerParam();
      setAnswered(true);
    },
  });

  if (answered) return null;

  const decline = () => {
    dropPartnerParam();
    setAnswered(true);
  };

  return (
    <div
      role="dialog"
      aria-labelledby="partner-link-title"
      data-slot="partner-link-prompt"
      className="bg-background fixed inset-x-3 bottom-3 z-50 mx-auto max-w-md rounded-2xl border p-4 shadow-lg sm:bottom-6"
    >
      <div className="flex items-start gap-3">
        <div className="bg-primary/10 text-primary flex size-9 shrink-0 items-center justify-center rounded-full">
          <Handshake className="size-4" aria-hidden />
        </div>
        <div className="min-w-0 space-y-1">
          <p id="partner-link-title" className="font-medium">
            {t("title", { partner: partnerName })}
          </p>
          <p className="text-muted-foreground text-sm">{t("question", { partner: partnerName })}</p>
        </div>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={decline} disabled={accept.isPending}>
          {t("decline")}
        </Button>
        <Button size="sm" onClick={() => accept.mutate()} disabled={accept.isPending}>
          {t("accept")}
        </Button>
      </div>
      <p className="text-muted-foreground mt-3 text-xs">{t("note")}</p>
    </div>
  );
};
