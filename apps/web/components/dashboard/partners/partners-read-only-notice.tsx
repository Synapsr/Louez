"use client";

import { Lock } from "lucide-react";
import { useTranslations } from "next-intl";

/**
 * Why a member's partner controls are disabled: the partner writes need
 * `manage_settings`, as the store's promo codes do. A presentation guard;
 * every write is refused by the API all the same.
 */
export const PartnersReadOnlyNotice = () => {
  const t = useTranslations("dashboard.partners");
  return (
    <p className="text-muted-foreground flex items-start gap-2 text-sm">
      <Lock aria-hidden className="mt-0.5 size-4 shrink-0" />
      {t("readOnly")}
    </p>
  );
};
