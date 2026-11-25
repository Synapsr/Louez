"use client";

import { useState } from "react";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";

import { PARTNER_ATTRIBUTION_DAY_OPTIONS } from "@louez/api/contracts/partners";
import {
  Button,
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  toastManager,
} from "@louez/ui";

import { apiErrorKey } from "@/lib/orpc/errors";
import { partnersMutations, partnersQueries } from "@/lib/queries/partners.queries";

interface PartnerSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  attributionDays: number;
}

/** How long a partner link holds, from the visitor's click to their booking. */
export const PartnerSettingsDialog = ({
  open,
  onOpenChange,
  attributionDays,
}: PartnerSettingsDialogProps) => {
  const t = useTranslations("dashboard.partners.settings");
  const tErrors = useTranslations("errors");
  const queryClient = useQueryClient();
  const [days, setDays] = useState(String(attributionDays));
  const save = useMutation({
    ...partnersMutations.updateSettings(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: partnersQueries.key() });
      onOpenChange(false);
    },
    onError: (error) => {
      const key = apiErrorKey(error);
      toastManager.add({
        title: key && tErrors.has(key) ? tErrors(key) : tErrors("generic"),
        type: "error",
      });
    },
  });
  const items = Object.fromEntries(
    PARTNER_ATTRIBUTION_DAY_OPTIONS.map((option) => [String(option), t("days", { count: option })]),
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) setDays(String(attributionDays));
        onOpenChange(next);
      }}
    >
      <DialogPopup className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>
        <DialogPanel className="space-y-2">
          <Label>{t("window")}</Label>
          <Select items={items} value={days} onValueChange={(value) => value && setDays(value)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PARTNER_ATTRIBUTION_DAY_OPTIONS.map((option) => (
                <SelectItem key={option} value={String(option)}>
                  {items[String(option)]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </DialogPanel>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("cancel")}
          </Button>
          <Button
            isPending={save.isPending}
            onClick={() => save.mutate({ attributionDays: Number(days) })}
          >
            {t("save")}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
};
