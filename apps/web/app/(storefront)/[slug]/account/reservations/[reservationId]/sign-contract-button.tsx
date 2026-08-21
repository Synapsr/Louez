"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { PenLine } from "lucide-react";

import { Button } from "@louez/ui";

interface SignContractButtonProps {
  reservationId: string;
  label: string;
  confirmation: string;
  errorLabel: string;
}

export const SignContractButton = ({
  reservationId,
  label,
  confirmation,
  errorLabel,
}: SignContractButtonProps) => {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);
  const [hasError, setHasError] = useState(false);

  const handleSign = async () => {
    if (!window.confirm(confirmation)) return;

    setIsPending(true);
    setHasError(false);
    try {
      const response = await fetch(`/api/reservations/${reservationId}/sign`, { method: "POST" });
      if (!response.ok) throw new Error("Contract signature failed");
      router.refresh();
    } catch {
      setHasError(true);
    } finally {
      setIsPending(false);
    }
  };

  return (
    <div className="space-y-1">
      <Button onClick={handleSign} isPending={isPending} className="gap-2 self-start">
        <PenLine data-slot="icon" />
        {label}
      </Button>
      {hasError && <p className="text-destructive text-xs">{errorLabel}</p>}
    </div>
  );
};
