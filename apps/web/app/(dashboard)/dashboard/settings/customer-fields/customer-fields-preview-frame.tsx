"use client";

import type { CSSProperties, ReactNode } from "react";

import { Lock } from "lucide-react";
import { useTranslations } from "next-intl";

import { cn } from "@louez/utils";

import {
  getStoreThemeClassName,
  getStoreThemeVariables,
  type StoreThemeInput,
} from "@/lib/theme/util.store-theme";

type ThemeStyle = CSSProperties & Record<`--${string}`, string>;

interface CustomerFieldsPreviewFrameProps {
  storeName: string;
  theme: StoreThemeInput;
  children: ReactNode;
}

/**
 * A slice of the storefront checkout: the store's colour and mode, its name
 * in the header. The content decides what can be clicked (the asked fields)
 * and what is only there to be read.
 */
export const CustomerFieldsPreviewFrame = ({
  storeName,
  theme,
  children,
}: CustomerFieldsPreviewFrameProps) => {
  const t = useTranslations("storefront");
  const variables = getStoreThemeVariables(theme);
  // Runtime tenant colour: the storefront shell sets the same variables.
  const themeStyle: ThemeStyle | undefined = variables ? { ...variables } : undefined;

  return (
    <div
      style={themeStyle}
      className={cn(
        "@container/frame overflow-hidden rounded-2xl border bg-background text-foreground shadow-card",
        getStoreThemeClassName(theme.mode),
      )}
    >
      <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
        <span className="truncate text-sm font-semibold">{storeName}</span>
        <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
          <Lock aria-hidden className="size-3.5" />
          {t("header.secure")}
        </span>
      </div>
      <div className="flex flex-col gap-8 p-4 sm:p-5">{children}</div>
    </div>
  );
};
