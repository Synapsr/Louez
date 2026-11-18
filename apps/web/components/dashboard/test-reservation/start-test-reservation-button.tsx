"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { ExternalLink } from "lucide-react";

import { Button, toastManager } from "@louez/ui";

import { useStoreHasPermission } from "@/contexts/store-context";
import { testReservationQueries } from "@/lib/queries/test-reservations.queries";

import { openTestStorefront } from "./util.open-test-storefront";

interface StartTestReservationButtonProps {
  size?: "sm" | "default";
  className?: string;
}

/** "Faire une réservation test", or "Reprendre la réservation test" while one runs. */
export const StartTestReservationButton = ({
  size = "default",
  className,
}: StartTestReservationButtonProps) => {
  const t = useTranslations("dashboard.testReservation");
  const router = useRouter();
  const queryClient = useQueryClient();
  const canWrite = useStoreHasPermission("write");
  const [isPending, setIsPending] = useState(false);
  const { data } = useQuery(testReservationQueries.get());
  const existingReservationId = data?.reservation?.id;

  if (existingReservationId) {
    return (
      <Button
        size={size}
        variant="outline"
        className={className}
        render={<Link href={`/dashboard/reservations/${existingReservationId}`} />}
      >
        {t("resume")}
      </Button>
    );
  }

  if (!canWrite) return null;

  const handleStart = async () => {
    setIsPending(true);
    try {
      const result = await openTestStorefront();
      if ("existing" in result) router.push(`/dashboard/reservations/${result.existing}`);
    } catch {
      toastManager.add({ title: t("startError"), type: "error" });
    } finally {
      setIsPending(false);
      void queryClient.invalidateQueries({ queryKey: testReservationQueries.key() });
    }
  };

  return (
    <Button size={size} className={className} isPending={isPending} onClick={handleStart}>
      {t("start")}
      <ExternalLink />
    </Button>
  );
};
