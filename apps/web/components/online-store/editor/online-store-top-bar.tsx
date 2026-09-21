"use client";

import type { MouseEvent } from "react";

import Link from "next/link";

import { useTranslations } from "next-intl";

import { Button, Separator } from "@louez/ui";
import { ArrowLeftIcon, ExternalLinkIcon } from "@louez/ui/icons";

import { useKeyboardHotkey } from "@/components/shared/keyboard-shortcuts-provider";
import { useStorefrontUrl } from "@/hooks/use-storefront-url";
import { useStoreHasPermission } from "@/contexts/store-context";

import { useOnlineStoreEditor } from "../online-store-editor-context";
import type { OnlineStoreSection } from "../online-store.constants";
import { OnlineStoreDeviceToggle } from "./online-store-device-toggle";

interface OnlineStoreTopBarProps {
  section: OnlineStoreSection;
  isDirty: boolean;
  isSaving: boolean;
  onReset: () => void;
  onOpenPreview: () => void;
}

/**
 * The editor's one save: the button submits the form the whole editor
 * lives in, ⌘S finds it through `data-keyboard-shortcut-save`. The back
 * link asks before leaving unsaved changes behind.
 */
export const OnlineStoreTopBar = ({
  section,
  isDirty,
  isSaving,
  onReset,
  onOpenPreview,
}: OnlineStoreTopBarProps) => {
  const canManage = useStoreHasPermission("manage_settings");
  const t = useTranslations("dashboard.onlineStore");
  const tCommon = useTranslations("common");
  const { store, device, setDevice } = useOnlineStoreEditor();
  const { getAbsoluteUrl } = useStorefrontUrl(store.slug);
  const saveShortcut = useKeyboardHotkey("save");

  const confirmLeave = (event: MouseEvent<HTMLAnchorElement>) => {
    if (isDirty && !window.confirm(t("leaveConfirm"))) {
      event.preventDefault();
    }
  };

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b bg-background px-3 sm:gap-3 sm:px-4">
      <Link
        href="/dashboard"
        onClick={confirmLeave}
        className="flex h-9 shrink-0 items-center gap-1.5 rounded-md px-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeftIcon className="size-4" />
        <span className="hidden sm:inline">{t("backToDashboard")}</span>
      </Link>

      <Separator orientation="vertical" className="h-5 shrink-0" />

      <div className="min-w-0">
        <p className="text-[11px] leading-none text-muted-foreground">{t("title")}</p>
        <h1 className="truncate text-sm font-semibold leading-tight">
          {t(`sections.${section}.label`)}
        </h1>
      </div>

      <OnlineStoreDeviceToggle
        value={device}
        onChange={setDevice}
        className="mx-auto hidden lg:flex"
      />

      <div className="ml-auto flex shrink-0 items-center gap-2 lg:ml-0">
        {isDirty ? (
          <span
            role="status"
            className="hidden items-center gap-2 text-xs text-muted-foreground md:flex"
          >
            <span className="relative flex size-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75 motion-reduce:animate-none" />
              <span className="relative inline-flex size-1.5 rounded-full bg-amber-500" />
            </span>
            {tCommon("unsavedChanges")}
          </span>
        ) : null}

        <Button
          type="button"
          variant="outline"
          size="sm"
          className="lg:hidden"
          onClick={onOpenPreview}
        >
          {t("preview")}
        </Button>

        <Button
          variant="outline"
          size="sm"
          render={<a href={getAbsoluteUrl()} target="_blank" rel="noopener noreferrer" />}
        >
          <ExternalLinkIcon className="size-4" />
          <span className="hidden sm:inline">{t("viewStore")}</span>
        </Button>

        {isDirty ? (
          <Button type="button" variant="ghost" size="sm" onClick={onReset} disabled={isSaving}>
            {tCommon("cancel")}
          </Button>
        ) : null}

        {canManage && (
          <Button
            type="submit"
            size="sm"
            disabled={!isDirty}
            isPending={isSaving}
            data-keyboard-shortcut-save={isDirty ? "" : undefined}
          >
            {tCommon("save")}
            <kbd className="hidden font-mono text-[10px] text-current/70 sm:inline">
              {saveShortcut.label}
            </kbd>
          </Button>
        )}
      </div>
    </header>
  );
};
