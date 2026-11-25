"use client";

import { useEffect, useRef, useState } from "react";

import { useMutation } from "@tanstack/react-query";

import type { CheckoutPartner } from "@louez/api/services/partners";

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

/**
 * Liens partenaires at checkout: the partner's code the customer types, and
 * the perk (a promo code) of the partner who brought them, applied once for
 * them. The server credits the partner when the booking is made.
 */
export const useCheckoutPartner = ({
  storeId,
  linkPartner,
  promo,
  cartReady,
}: UseCheckoutPartnerParams) => {
  const [typed, setTyped] = useState<CheckoutPartner | null>(null);
  const [notFound, setNotFound] = useState(false);
  const { validate: applyPromo, promo: appliedPromo } = promo;

  const check = useMutation({
    mutationFn: (code: string) => checkPartnerCode({ storeId, code }),
    onSuccess: (partner) => {
      if (!partner) {
        setNotFound(true);
        return;
      }
      setNotFound(false);
      setTyped(partner);
      if (partner.perkCode && !appliedPromo) applyPromo(partner.perkCode);
    },
    onError: () => setNotFound(true),
  });

  // The link's perk, once the cart can be priced; never over a code the customer chose.
  const linkPerkApplied = useRef(false);
  useEffect(() => {
    if (linkPerkApplied.current || !cartReady || !linkPartner?.perkCode || appliedPromo) return;
    linkPerkApplied.current = true;
    applyPromo(linkPartner.perkCode);
  }, [applyPromo, appliedPromo, cartReady, linkPartner]);

  return {
    /** The typed partner the booking will credit, or null. */
    typed,
    notFound,
    isChecking: check.isPending,
    check: (code: string) => {
      if (code.trim()) check.mutate(code.trim());
    },
    remove: () => {
      setTyped(null);
      setNotFound(false);
    },
    clearNotFound: () => setNotFound(false),
  };
};
