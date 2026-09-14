"use client";

/**
 * The actions a season carries. They used to sit in a full-width banner that
 * repeated the season name already shown in the header selector; name and dates
 * now live beside the card title, and the three rare actions collapse in here.
 */

import { useState, useTransition } from "react";

import { useTranslations } from "next-intl";

import { Check, Copy, Loader2, MoreHorizontal, Pencil, Trash2 } from "lucide-react";

import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  toastManager,
} from "@louez/ui";

import { deleteSeasonalPricing, duplicateSeasonalPricing } from "../seasonal-actions";
import type { SeasonalPricingData } from "../types";
import type { SeasonalSaveStatus } from "./use-seasonal-pricing-draft";

export function SeasonalSaveIndicator({ status }: { status: SeasonalSaveStatus }) {
  const t = useTranslations("dashboard.products.form");
  if (status === "idle") return null;
  return (
    <span className="text-muted-foreground flex shrink-0 items-center gap-1.5 text-xs">
      {status === "saving" ? (
        <>
          <Loader2 className="h-3 w-3 animate-spin" />
          {t("savingPeriod")}
        </>
      ) : (
        <>
          <Check className="h-3 w-3 text-emerald-600" />
          {t("periodSaved")}
        </>
      )}
    </span>
  );
}

export function SeasonalActionsMenu({
  period,
  onEditMetadata,
  onDeleted,
  onDuplicated,
  onBeforeDuplicate,
  disabled,
}: {
  period: SeasonalPricingData;
  onEditMetadata: () => void;
  onDeleted: () => void;
  onDuplicated: (newId: string) => void;
  onBeforeDuplicate: () => Promise<void>;
  disabled?: boolean;
}) {
  const t = useTranslations("dashboard.products.form");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const handleDuplicate = async () => {
    // Whatever is still pending in the debounce belongs in the copy.
    await onBeforeDuplicate();
    startTransition(async () => {
      const result = await duplicateSeasonalPricing(period.id);
      if (result && "error" in result) {
        toastManager.add({ title: result.error, type: "error" });
        return;
      }
      if (result && "id" in result) {
        toastManager.add({ title: t("seasonDuplicated"), type: "success" });
        onDuplicated(result.id);
      }
    });
  };

  const handleDelete = () => {
    startTransition(async () => {
      const result = await deleteSeasonalPricing(period.id);
      if (result && "error" in result) {
        toastManager.add({ title: result.error, type: "error" });
        return;
      }
      setConfirmOpen(false);
      onDeleted();
    });
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground shrink-0"
              disabled={disabled || isPending}
              aria-label={t("seasonActions")}
            />
          }
        >
          <MoreHorizontal className="h-4 w-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={onEditMetadata}>
            <Pencil className="mr-2 h-4 w-4" />
            {t("editPeriodMetadata")}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleDuplicate}>
            <Copy className="mr-2 h-4 w-4" />
            {t("duplicateSeason")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            onClick={() => setConfirmOpen(true)}
          >
            <Trash2 className="mr-2 h-4 w-4" />
            {t("deleteSeason")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("deleteSeasonTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              « {period.name} » et ses tarifs seront supprimés. Le tarif de base reprend la main sur
              ces dates.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>{t("cancel")}</AlertDialogClose>
            <Button variant="destructive" onClick={handleDelete} disabled={isPending}>
              {t("deleteSeason")}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
