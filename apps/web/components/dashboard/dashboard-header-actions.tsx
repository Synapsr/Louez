"use client";

import { useState } from "react";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { Lock, Plus } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button, Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@louez/ui";
import { useIsMobile } from "@louez/ui/hooks/use-mobile";

import { UpgradeModal } from "@/components/dashboard/upgrade-modal";
import { useKeyboardShortcutSequence } from "@/components/shared/keyboard-shortcuts-provider";

import type { LimitStatus } from "@/lib/plan-limits";

import { DashboardCommandPalette } from "./ai-chat/command-palette";
import { DashboardNotificationsButton } from "./dashboard-notifications-button";

export const DashboardHeaderActions = ({
  showAIChat,
  reservationLimits,
  planSlug,
  isPlatformAdmin = false,
  electronicInvoicingEnabled = true,
}: {
  showAIChat: boolean;
  reservationLimits: LimitStatus;
  planSlug: string;
  isPlatformAdmin?: boolean;
  electronicInvoicingEnabled?: boolean;
}) => {
  const t = useTranslations("dashboard");
  const router = useRouter();
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const isAtReservationLimit = reservationLimits.isAtLimit;
  const isMobile = useIsMobile();
  const createReservationShortcut = useKeyboardShortcutSequence("createReservation");

  const handleCreateReservation = () => {
    if (isAtReservationLimit) {
      setShowUpgradeModal(true);
      return;
    }

    router.push("/dashboard/reservations/new");
  };

  const newReservationButton = isAtReservationLimit ? (
    <Button
      aria-label={t("sidebar.newReservation")}
      size={isMobile ? "icon" : "default"}
      variant="outline"
      onClick={handleCreateReservation}
    >
      <Lock className="h-4 w-4" />
      <span className="max-md:hidden">{t("sidebar.newReservation")}</span>
    </Button>
  ) : (
    <Button
      aria-label={t("sidebar.newReservation")}
      size={isMobile ? "icon" : "default"}
      render={<Link href="/dashboard/reservations/new?source=dashboard_header" />}
      variant="outline"
    >
      <Plus className="h-4 w-4" />
      <span className="max-md:hidden">{t("sidebar.newReservation")}</span>
    </Button>
  );

  return (
    <>
      <div className="ml-auto flex shrink-0 items-center gap-2">
        <DashboardCommandPalette
          isPlatformAdmin={isPlatformAdmin}
          electronicInvoicingEnabled={electronicInvoicingEnabled}
          showAIChat={showAIChat}
          onCreateReservation={handleCreateReservation}
        />
        <DashboardNotificationsButton />
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger render={newReservationButton} />
            <TooltipContent className="flex items-center gap-3">
              <span>{t("shortcuts.actions.createReservation")}</span>
              <kbd className="bg-muted text-muted-foreground rounded border px-1.5 py-0.5 font-mono text-[10px] font-medium">
                {createReservationShortcut.label}
              </kbd>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
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
