"use client";

import type { ComponentType, ReactNode } from "react";

import { Check, LoaderCircle, X } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button, DisabledControlsProvider, SheetTitle } from "@louez/ui";

import type { CustomerFieldSaveStatus } from "./use-customer-field-autosave";

interface CustomerFieldSheetHeaderProps {
  title: string;
  /** What the field is: its type, or "Champ Louez". */
  kind: { icon: ComponentType<{ className?: string }>; label: string };
  /** Omitted where nothing is saved as it changes (a field being created, a locked one). */
  status?: CustomerFieldSaveStatus;
  /** The field's "⋯"; only the store's own fields have one. */
  menu?: ReactNode;
  onClose: () => void;
}

/** The Sheet's top: which field, what it is, and whether the last change is saved. */
export const CustomerFieldSheetHeader = ({
  title,
  kind: { icon: KindIcon, label: kindLabel },
  status = "idle",
  menu,
  onClose,
}: CustomerFieldSheetHeaderProps) => {
  const t = useTranslations("dashboard.settings.customerFields.builder.inspector");

  return (
    <div className="flex items-start gap-3 border-b px-4 py-3.5 sm:px-5">
      <div className="min-w-0 flex-1">
        <SheetTitle className="line-clamp-2 text-base leading-snug font-semibold break-words">
          {title}
        </SheetTitle>
        <p className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          <span className="inline-flex items-center gap-1">
            <KindIcon aria-hidden className="size-3.5" />
            {kindLabel}
          </span>
          <span aria-live="polite" className="inline-flex items-center gap-1">
            {status === "saving" && (
              <>
                <LoaderCircle aria-hidden className="size-3.5 animate-spin" />
                {t("saving")}
              </>
            )}
            {status === "saved" && (
              <>
                <Check aria-hidden className="text-badge-success-foreground size-3.5" />
                {t("saved")}
              </>
            )}
          </span>
        </p>
      </div>
      <div className="-me-1.5 -mt-0.5 flex shrink-0 items-center gap-1">
        {menu}
        {/* Closing only changes the view: read-only members may too. */}
        <DisabledControlsProvider disabled={false}>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t("close")}
            // Full screen on a phone: the way out reads as a button, like every Sheet's.
            className="text-muted-foreground max-sm:bg-muted max-sm:size-11"
            onClick={onClose}
          >
            <X className="size-4" />
          </Button>
        </DisabledControlsProvider>
      </div>
    </div>
  );
};
