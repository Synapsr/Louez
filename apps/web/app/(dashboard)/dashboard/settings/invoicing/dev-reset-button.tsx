"use client";

import { useRouter } from "next/navigation";

import { useMutation } from "@tanstack/react-query";

import { Button } from "@louez/ui";
import { TrashSolidIcon } from "@louez/ui/icons";

import { resetInvoicingSetupForDev } from "./actions";

/**
 * Development-only helper: wipes the legal profile and the Super PDP
 * enrollment of the store so the setup wizard can be replayed from step 1.
 * Never rendered in production, hence the hardcoded label.
 */
export const DevResetButton = () => {
  const router = useRouter();

  const resetMutation = useMutation({
    mutationFn: resetInvoicingSetupForDev,
    onSuccess: () => router.refresh(),
  });

  return (
    <Button
      type="button"
      size="sm"
      variant="destructive"
      isPending={resetMutation.isPending}
      onClick={() => resetMutation.mutate()}
    >
      <TrashSolidIcon />
      Reset (dev)
    </Button>
  );
};
