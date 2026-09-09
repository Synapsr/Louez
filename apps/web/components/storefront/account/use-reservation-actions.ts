"use client";

import { useState } from "react";

import { useRouter } from "next/navigation";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";

import {
  acceptQuote,
  createReservationPaymentSession,
  declineQuote,
} from "@/app/(storefront)/[slug]/account/reservations/[reservationId]/actions";

import { invalidateStorefrontReservationData } from "@/lib/queries/storefront.invalidation";

interface UseReservationActionsInput {
  storeSlug: string;
  reservationId: string;
}

class ActionFailure extends Error {}

/** Action error keys may still carry the legacy `errors.` prefix. */
const toErrorKey = (value: string): string =>
  value.startsWith("errors.") ? value.slice(7) : value;

const toActionError = (result: { error?: string }): never => {
  throw new ActionFailure(toErrorKey(result.error ?? "generic"));
};

/**
 * The customer mutations of a reservation. Each one refreshes the
 * server page on success; every error becomes one translated line.
 */
export const useReservationActions = ({ storeSlug, reservationId }: UseReservationActionsInput) => {
  const router = useRouter();
  const queryClient = useQueryClient();
  const refreshReservation = () => {
    void invalidateStorefrontReservationData(queryClient);
    router.refresh();
  };
  const tErrors = useTranslations("errors");
  const [error, setError] = useState<string | null>(null);

  const fail = (failure: unknown, fallback: string) => {
    setError(failure instanceof ActionFailure ? tErrors(failure.message) : fallback);
  };

  const pay = useMutation({
    mutationFn: async () => {
      const result = await createReservationPaymentSession(storeSlug, reservationId);
      if ("paymentUrl" in result && result.paymentUrl) return result.paymentUrl;
      if ("success" in result) return null;
      return toActionError(result);
    },
    onMutate: () => setError(null),
    onSuccess: (paymentUrl) => {
      if (paymentUrl) window.location.assign(paymentUrl);
      else refreshReservation();
    },
    onError: (failure) => fail(failure, tErrors("paymentSessionError")),
  });

  const accept = useMutation({
    mutationFn: async () => {
      const result = await acceptQuote(storeSlug, reservationId);
      if ("success" in result) return result.paymentUrl ?? null;
      return toActionError(result);
    },
    onMutate: () => setError(null),
    onSuccess: (paymentUrl) => {
      if (paymentUrl) window.location.assign(paymentUrl);
      else refreshReservation();
    },
    onError: (failure) => fail(failure, tErrors("generic")),
  });

  const decline = useMutation({
    mutationFn: async () => {
      const result = await declineQuote(storeSlug, reservationId);
      if (!("success" in result)) toActionError(result);
    },
    onMutate: () => setError(null),
    onSuccess: refreshReservation,
    onError: (failure) => fail(failure, tErrors("generic")),
  });

  return { pay, accept, decline, error };
};
