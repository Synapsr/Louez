"use client";

import type { ReactNode } from "react";

import { useTranslations } from "next-intl";

interface ProfileFieldsSectionProps {
  /** One input per native field asked, in the record's order. */
  children: ReactNode;
}

/**
 * "Profil": the native fields (birth date, source, links) under their own
 * title, drawn like a section of the store's own questions and placed before them.
 */
export const ProfileFieldsSection = ({ children }: ProfileFieldsSectionProps) => {
  const t = useTranslations("storefront.customerFields");

  return (
    <section className="flex flex-col gap-4">
      <h3 className="text-base font-semibold leading-tight">{t("profile.title")}</h3>
      {children}
    </section>
  );
};
