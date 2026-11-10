"use client";

import { useState } from "react";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { ChevronDown, Lock, PackagePlus, Plus, Share2, UserPlus } from "lucide-react";
import { useTranslations } from "next-intl";

import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@louez/ui";
import { useIsMobile } from "@louez/ui/hooks/use-mobile";
import { cn } from "@louez/utils";

import { UpgradeModal } from "@/components/dashboard/upgrade-modal";
import { useStoreShare } from "@/contexts/store-share-context";
import { useKeyboardShortcutSequence } from "@/components/shared/keyboard-shortcuts-provider";

import type { LimitStatus } from "@/lib/plan-limits";

import { DashboardCommandPalette } from "./ai-chat/command-palette";
import { DashboardNotificationsButton } from "./dashboard-notifications-button";

export const DashboardHeaderActions = ({
  showAIChat,
  reservationLimits,
  planSlug,
  isPlatformAdmin = false,
  legacyBillingEnabled = false,
  billingPagesEnabled = false,
  electronicInvoicingEnabled = true,
}: {
  showAIChat: boolean;
  reservationLimits: LimitStatus;
  planSlug: string;
  isPlatformAdmin?: boolean;
  legacyBillingEnabled?: boolean;
  billingPagesEnabled?: boolean;
  electronicInvoicingEnabled?: boolean;
}) => {
  const t = useTranslations("dashboard");
  const router = useRouter();
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const isAtReservationLimit = reservationLimits.isAtLimit;
  const isMobile = useIsMobile();
  const createReservationShortcut = useKeyboardShortcutSequence("createReservation");
  const share = useStoreShare();

  const handleCreateReservation = () => {
    if (isAtReservationLimit) {
      setShowUpgradeModal(true);
      return;
    }

    router.push("/dashboard/reservations/new");
  };

  /**
   * One button in two parts: "+ Nouvelle réservation", and a narrow chevron
   * for the other creations. The shell carries the primary button's look
   * (gradient, radius, shadow) once, so the halves read as one control;
   * each half only lightens on hover. At the plan's limit it turns outline,
   * with the lock.
   */
  const segment =
    "focus-visible:ring-ring/40 flex items-center transition-colors duration-150 outline-hidden focus-visible:ring-[3px] focus-visible:ring-inset";
  const segmentHover = isAtReservationLimit ? "hover:bg-accent" : "hover:bg-primary-foreground/10";
  const newReservationLabel = (
    <>
      {isAtReservationLimit ? <Lock className="size-4" /> : <Plus className="size-4" />}
      <span>{t("sidebar.newReservation")}</span>
    </>
  );
  const newReservationButton = isAtReservationLimit ? (
    <button
      type="button"
      onClick={handleCreateReservation}
      className={cn(segment, segmentHover, "gap-2 ps-3.5 pe-3")}
    >
      {newReservationLabel}
    </button>
  ) : (
    <Link
      href="/dashboard/reservations/new?source=dashboard_header"
      className={cn(segment, segmentHover, "gap-2 ps-3.5 pe-3")}
    >
      {newReservationLabel}
    </Link>
  );

  // The other things one creates in a hurry, and the store's share sheet.
  const createMenuItems = (
    <DropdownMenuContent align="end" className="w-56">
      <DropdownMenuItem onClick={handleCreateReservation}>
        {isAtReservationLimit ? <Lock /> : <Plus />}
        {t("sidebar.newReservation")}
        <DropdownMenuShortcut>{createReservationShortcut.label}</DropdownMenuShortcut>
      </DropdownMenuItem>
      <DropdownMenuItem render={<Link href="/dashboard/products/new" />}>
        <PackagePlus />
        {t("headerMenu.newProduct")}
      </DropdownMenuItem>
      <DropdownMenuItem render={<Link href="/dashboard/customers/new" />}>
        <UserPlus />
        {t("headerMenu.newCustomer")}
      </DropdownMenuItem>
      {share.url && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={share.open}>
            <Share2 />
            {t("headerMenu.shareStore")}
          </DropdownMenuItem>
        </>
      )}
    </DropdownMenuContent>
  );

  return (
    <>
      <div className="ml-auto flex shrink-0 items-center gap-2">
        <DashboardCommandPalette
          isPlatformAdmin={isPlatformAdmin}
          legacyBillingEnabled={legacyBillingEnabled}
          billingPagesEnabled={billingPagesEnabled}
          electronicInvoicingEnabled={electronicInvoicingEnabled}
          showAIChat={showAIChat}
          onCreateReservation={handleCreateReservation}
        />
        <DashboardNotificationsButton />
        {isMobile ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button size="icon" aria-label={t("headerMenu.create")} />}
            >
              <Plus className="h-4 w-4" />
            </DropdownMenuTrigger>
            {createMenuItems}
          </DropdownMenu>
        ) : (
          <div
            className={cn(
              "flex h-9 items-stretch overflow-hidden rounded-[10px] text-sm font-bold",
              isAtReservationLimit
                ? "border-input bg-background text-foreground border"
                : "from-primary/90 to-primary text-primary-foreground bg-linear-to-b shadow-[0_1px_2px_--theme(--color-black/12%),inset_0_1px_0_--theme(--color-white/28%)]",
            )}
          >
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
            <span
              aria-hidden
              className={cn(
                "my-2 w-px",
                isAtReservationLimit ? "bg-border" : "bg-primary-foreground/25",
              )}
            />
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <button
                    type="button"
                    aria-label={t("headerMenu.more")}
                    className={cn(segment, segmentHover, "px-2.5")}
                  />
                }
              >
                <ChevronDown className="size-4 opacity-90" />
              </DropdownMenuTrigger>
              {createMenuItems}
            </DropdownMenu>
          </div>
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
