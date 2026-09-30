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
 * in the header, and content the owner can look at but not use (`inert`).
 * The frame itself stays scrollable so a long form fits the sticky column.
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
        "overflow-hidden rounded-2xl border bg-background text-foreground",
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
      <div className="max-h-[calc(100dvh-18rem)] overflow-y-auto">
        <div inert className="flex flex-col gap-6 p-4">
          {children}
        </div>
      </div>
    </div>
  );
};
