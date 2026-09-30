"use client";

import { Lock } from "lucide-react";
import { useTranslations } from "next-intl";

import { Checkbox, Input, Label } from "@louez/ui";

/**
 * The contact questions every checkout asks, as the storefront draws them:
 * there for context, locked (Louez always asks them).
 */
export const CustomerFieldsPreviewContact = () => {
  const t = useTranslations("storefront.checkout");
  const tBuilder = useTranslations("dashboard.settings.customerFields.builder.client");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h2 className="text-xl font-semibold leading-tight tracking-tight">{t("steps.contact")}</h2>
        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <Lock aria-hidden className="size-3.5" />
          {tBuilder("lockedNote")}
        </span>
      </div>
      <div inert className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label>{t("email")}</Label>
          <Input placeholder={t("emailPlaceholder")} />
        </div>
        <div className="grid gap-3 @sm/frame:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label>{t("firstName")}</Label>
            <Input placeholder={t("firstNamePlaceholder")} />
          </div>
          <div className="flex flex-col gap-2">
            <Label>{t("lastName")}</Label>
            <Input placeholder={t("lastNamePlaceholder")} />
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <Label>{t("phone")}</Label>
          <Input placeholder={t("phonePlaceholder")} />
        </div>
        <div className="flex min-h-11 items-center gap-2">
          <Checkbox />
          <span className="text-sm">{t("isBusinessCustomer")}</span>
        </div>
      </div>
    </div>
  );
};
