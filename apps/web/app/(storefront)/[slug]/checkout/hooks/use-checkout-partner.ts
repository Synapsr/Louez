"use client";

import { useEffect, useRef, useState } from "react";

import { useMutation } from "@tanstack/react-query";

import { checkPartnerCode } from "../actions";
import type { CheckoutLinkPartner } from "../checkout.types";
import type { useCheckoutPromo } from "./use-checkout-promo";

interface UseCheckoutPartnerParams {
  storeId: string;
  /** The partner whose link brought the visitor, read by the page; null without one. */
  linkPartner: CheckoutLinkPartner | null;
  promo: ReturnType<typeof useCheckoutPromo>;
  /** The cart is read: a perk can be priced. */
  cartReady: boolean;
}

/** Why a typed code was not taken. */
type PartnerCodeIssue = "notFound" | "rateLimited";

/**
 * Liens partenaires at checkout: the partner's code the customer types, and
 * the perk of the partner who brought them, applied once for them. The page
 * only knows what the customer sees of a perk; the server applies its promo
 * code and credits the partner when the booking is made.
 */
export const useCheckoutPartner = ({
  storeId,
  linkPartner,
  promo,
  cartReady,
}: UseCheckoutPartnerParams) => {
  const [typed, setTyped] = useState<{ code: string; name: string } | null>(null);
  const [issue, setIssue] = useState<PartnerCodeIssue | null>(null);
  const { applyPartnerPerk, removePartnerPerk, promo: appliedPromo } = promo;

  const check = useMutation({
    mutationFn: (code: string) => checkPartnerCode({ storeId, code }),
    onSuccess: (answer, code) => {
      if (answer.status !== "found") {
        setIssue(answer.status === "rate_limited" ? "rateLimited" : "notFound");
        return;
      }
      setIssue(null);
      setTyped({ code, name: answer.partner.name });
      if (answer.partner.perk) applyPartnerPerk(answer.partner.perk);
    },
    onError: () => setIssue("notFound"),
  });

  // The link's perk, once the cart can be priced; never over a code the customer chose.
  const linkPerkApplied = useRef(false);
  useEffect(() => {
    if (linkPerkApplied.current || !cartReady || !linkPartner?.perk || appliedPromo) return;
    linkPerkApplied.current = true;
    applyPartnerPerk(linkPartner.perk);
  }, [applyPartnerPerk, appliedPromo, cartReady, linkPartner]);

  return {
    /** The typed partner the booking will credit, or null. */
    typed,
    issue,
    isChecking: check.isPending,
    check: (code: string) => {
      if (code.trim()) check.mutate(code.trim());
    },
    /** Credits no partner any more; its perk goes with it. */
    remove: () => {
      setTyped(null);
      setIssue(null);
      removePartnerPerk();
    },
    clearIssue: () => setIssue(null),
  };
};
