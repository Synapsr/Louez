"use client";

import type { ReactNode } from "react";

import { useTranslations } from "next-intl";

import { cn } from "@louez/utils";

interface CustomerFieldsClientFieldProps {
  label: string;
  selected: boolean;
  onSelect: () => void;
  children: ReactNode;
}

/**
 * A field of the checkout preview the owner can pick: the storefront input,
 * inert, under one button that opens its settings.
 */
export const CustomerFieldsClientField = ({
  label,
  selected,
  onSelect,
  children,
}: CustomerFieldsClientFieldProps) => {
  const t = useTranslations("dashboard.settings.customerFields.builder.field");

  return (
    <div
      className={cn(
        "relative -mx-2 rounded-xl px-2 py-2 transition-colors",
        selected ? "bg-primary/5 ring-2 ring-primary/50" : "hover:bg-muted/70",
      )}
    >
      <button
        type="button"
        aria-pressed={selected}
        aria-label={t("select", { label })}
        className="absolute inset-0 z-10 cursor-pointer rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={onSelect}
      />
      <div inert>{children}</div>
    </div>
  );
};
