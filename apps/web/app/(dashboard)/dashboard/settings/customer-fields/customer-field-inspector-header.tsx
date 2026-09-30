"use client";

import type { ReactNode } from "react";

import { Check, LoaderCircle, Package, UserRound, X } from "lucide-react";
import { useTranslations } from "next-intl";

import type { CustomerFieldScope, CustomerFieldType } from "@louez/types";
import { Button, DisabledControlsProvider } from "@louez/ui";

import { CUSTOMER_FIELD_TYPE_ICONS } from "./customer-field-type-icon";
import type { CustomerFieldSaveStatus } from "./use-customer-field-autosave";

interface CustomerFieldInspectorHeaderProps {
  title: string;
  type: CustomerFieldType;
  scope: CustomerFieldScope;
  /** Omitted for a field being created: nothing is saved until "Ajouter". */
  status?: CustomerFieldSaveStatus;
  /** The field's "⋯"; none for a field being created. */
  menu?: ReactNode;
  onClose: () => void;
}

const SCOPE_ICONS = { customer: UserRound, item: Package } as const;

/** What is selected, where its values live, and whether the last change is saved. */
export const CustomerFieldInspectorHeader = ({
  title,
  type,
  scope,
  status = "idle",
  menu,
  onClose,
}: CustomerFieldInspectorHeaderProps) => {
  const t = useTranslations("dashboard.settings.customerFields");
  const TypeIcon = CUSTOMER_FIELD_TYPE_ICONS[type];
  const ScopeIcon = SCOPE_ICONS[scope];

  return (
    <div className="flex items-start gap-3 border-b p-4">
      <span className="bg-muted text-muted-foreground flex size-9 shrink-0 items-center justify-center rounded-lg">
        <TypeIcon aria-hidden className="size-4" />
      </span>
      <div className="min-w-0 flex-1">
        <h2 className="line-clamp-2 text-base font-semibold leading-snug break-words">{title}</h2>
        <p className="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
          <span className="inline-flex items-center gap-1">
            <ScopeIcon aria-hidden className="size-3.5" />
            {t(`dialog.scopes.${scope}`)}
          </span>
          <span aria-live="polite" className="inline-flex items-center gap-1">
            {status === "saving" && (
              <>
                <LoaderCircle aria-hidden className="size-3.5 animate-spin" />
                {t("builder.inspector.saving")}
              </>
            )}
            {status === "saved" && (
              <>
                <Check aria-hidden className="text-badge-success-foreground size-3.5" />
                {t("builder.inspector.saved")}
              </>
            )}
          </span>
        </p>
      </div>
      <div className="-me-1.5 -mt-0.5 flex shrink-0 items-center">
        {menu}
        {/* Closing only changes the view: read-only members may too. */}
        <DisabledControlsProvider disabled={false}>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t("builder.inspector.close")}
            className="text-muted-foreground"
            onClick={onClose}
          >
            <X className="size-4" />
          </Button>
        </DisabledControlsProvider>
      </div>
    </div>
  );
};
