"use client";

import { useState } from "react";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { Lock, Plus } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@louez/ui";
import { useIsMobile } from "@louez/ui/hooks/use-mobile";

import { UpgradeModal } from "@/components/dashboard/upgrade-modal";

import type { LimitStatus } from "@/lib/plan-limits";

import { DashboardCommandPalette } from "./ai-chat/command-palette";
import { DashboardNotificationsButton } from "./dashboard-notifications-button";

export const DashboardHeaderActions = ({
  showAIChat,
  reservationLimits,
  planSlug,
}: {
  showAIChat: boolean;
  reservationLimits: LimitStatus;
  planSlug: string;
}) => {
  const t = useTranslations("dashboard.sidebar");
  const router = useRouter();
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const isAtReservationLimit = reservationLimits.isAtLimit;

  const isMobile = useIsMobile();

  return (
    <>
      <div className="ml-auto flex shrink-0 items-center gap-2">
        <DashboardCommandPalette
          showAIChat={showAIChat}
          onCreateReservation={() => {
            if (isAtReservationLimit) {
              setShowUpgradeModal(true);
              return;
            }

            router.push("/dashboard/reservations/new");
          }}
        />
        <DashboardNotificationsButton />
        {isAtReservationLimit ? (
          <Button
            size={isMobile ? "icon" : "default"}
            variant="outline"
            onClick={() => setShowUpgradeModal(true)}
          >
            <Lock className="h-4 w-4" />
            <span className="max-md:hidden">{t("newReservation")}</span>
          </Button>
        ) : (
          <Button
            size={isMobile ? "icon" : "default"}
            render={<Link href="/dashboard/reservations/new" />}
            variant="outline"
          >
            <Plus className="h-4 w-4" />
            <span className="max-md:hidden">{t("newReservation")}</span>
          </Button>
        )}
      </div>
      <UpgradeModal
        open={showUpgradeModal}
        onOpenChange={setShowUpgradeModal}
        limitType="reservations"
        currentCount={reservationLimits.current}
        limit={reservationLimits.limit || 10}
        currentPlan={planSlug}
      />
    </>
  );
};
