"use client";

import { useState } from "react";

import { useMutation } from "@tanstack/react-query";
import { useTranslations } from "next-intl";

import type { PartnerNotifications } from "@louez/api/contracts/partners";
import { Button, Input, Label, Switch, toastManager } from "@louez/ui";

interface PartnerSpaceNotificationsProps {
  token: string;
  initial: PartnerNotifications;
}

const KINDS = ["bookings", "payouts", "statements"] as const;

/** Sends the partner's choice of e-mails to its space's route; the secret is the only key. */
const saveNotifications = async (token: string, value: PartnerNotifications): Promise<void> => {
  const response = await fetch(`/partner/${encodeURIComponent(token)}/notifications`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(value),
  });
  if (!response.ok) throw new Error(`partner notifications refused: ${response.status}`);
};

/** Where the partner's e-mails go, and which ones it wants. */
export const PartnerSpaceNotifications = ({ token, initial }: PartnerSpaceNotificationsProps) => {
  const t = useTranslations("partnerSpace.notifications");
  const [value, setValue] = useState<PartnerNotifications>(initial);
  const save = useMutation({
    mutationFn: () => saveNotifications(token, { ...value, email: value.email?.trim() || null }),
    onSuccess: () => toastManager.add({ title: t("saved"), type: "success" }),
    onError: () => toastManager.add({ title: t("failed"), type: "error" }),
  });

  return (
    <form
      className="space-y-4"
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate();
      }}
    >
      <div className="space-y-2">
        <Label htmlFor="partner-notify-email">{t("email")}</Label>
        <Input
          id="partner-notify-email"
          type="email"
          value={value.email ?? ""}
          placeholder={t("emailPlaceholder")}
          onChange={(event) => setValue({ ...value, email: event.target.value })}
        />
      </div>
      <div className="divide-y rounded-lg border">
        {KINDS.map((kind) => (
          <label key={kind} className="flex items-center justify-between gap-4 px-3 py-3 text-sm">
            <span>
              <span className="block font-medium">{t(`${kind}.title`)}</span>
              <span className="text-muted-foreground block">{t(`${kind}.description`)}</span>
            </span>
            <Switch
              checked={value[kind]}
              onCheckedChange={(checked) => setValue({ ...value, [kind]: checked })}
            />
          </label>
        ))}
      </div>
      <Button type="submit" isPending={save.isPending}>
        {t("save")}
      </Button>
    </form>
  );
};
