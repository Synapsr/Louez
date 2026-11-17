"use client";

import { useMutation } from "@tanstack/react-query";
import { useTranslations } from "next-intl";

import { Alert, AlertDescription, Button } from "@louez/ui";

import { simulateTestPayment } from "./actions";

interface SimulatePaymentButtonProps {
  slug: string;
  reservationId: string;
  /** The button's text: "Simuler le paiement", or "Voir la réservation" once it is paid. */
  label: string;
}

/** One button: the simulated payment, then the reservation page, signed in. */
export const SimulatePaymentButton = ({
  slug,
  reservationId,
  label,
}: SimulatePaymentButtonProps) => {
  const tErrors = useTranslations("errors");
  const simulate = useMutation({
    mutationFn: () => simulateTestPayment({ slug, reservationId }),
    onSuccess: (result) => {
      if (result.ok) window.location.assign(result.url);
    },
  });
  const failure = simulate.isError
    ? tErrors("generic")
    : simulate.data && !simulate.data.ok
      ? tErrors(simulate.data.error.replace(/^errors\./, ""))
      : null;

  return (
    <div className="flex flex-col gap-3">
      {failure ? (
        <Alert variant="error">
          <AlertDescription>{failure}</AlertDescription>
        </Alert>
      ) : null}
      <Button
        size="xl"
        className="h-12 w-full lg:h-10"
        isPending={simulate.isPending || simulate.data?.ok === true}
        onClick={() => simulate.mutate()}
      >
        {label}
      </Button>
    </div>
  );
};
