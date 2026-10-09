"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArrowLeft } from "lucide-react";
import { Button } from "@louez/ui";

import { getDashboardReservationBackHref } from "@/lib/dashboard/util.reservation-navigation";

interface ReservationBackButtonProps {
  onBack?: () => void;
  readOnly?: boolean;
}

export const ReservationBackButton = ({ onBack, readOnly = false }: ReservationBackButtonProps) => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const t = useTranslations("common");

  const handleBack = () => {
    if (onBack) {
      onBack();
      return;
    }

    if (!readOnly && window.history.length > 1) {
      router.back();
      return;
    }

    router.push(
      readOnly
        ? "/demos/landing/planning"
        : getDashboardReservationBackHref(searchParams.get("returnTo")),
    );
  };

  return (
    <Button onClick={handleBack} variant="ghost" size="icon" className="shrink-0 -ml-2 mt-0.5">
      <ArrowLeft className="h-4 w-4" />
      <span className="sr-only">{t("back")}</span>
    </Button>
  );
};
