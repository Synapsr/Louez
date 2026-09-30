"use client";

import { useSortable } from "@dnd-kit/react/sortable";
import { Globe, GripVertical, MoreHorizontal, Package, TriangleAlert } from "lucide-react";
import { useTranslations } from "next-intl";

import type { CustomerFieldDefinition } from "@louez/types";
import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  Switch,
} from "@louez/ui";
import { cn } from "@louez/utils";

import { CustomerFieldTargetSummary } from "./customer-field-target-summary";
import { CUSTOMER_FIELD_TYPE_ICONS } from "./customer-field-type-icon";
import { describeTargeting } from "./util.customer-field-online";

export interface CustomerFieldRowActions {
  onEdit: (field: CustomerFieldDefinition) => void;
  onSetActive: (field: CustomerFieldDefinition, isActive: boolean) => void;
  onMove: (field: CustomerFieldDefinition, section: string) => void;
  onDelete: (field: CustomerFieldDefinition) => void;
}

interface CustomerFieldRowProps extends CustomerFieldRowActions {
  field: CustomerFieldDefinition;
  index: number;
  /** Sortable group: a field is only dragged within its own section. */
  group: string;
  otherSections: string[];
  disabled: boolean;
}

export const CustomerFieldRow = ({
  field,
  index,
  group,
  otherSections,
  disabled,
  onEdit,
  onSetActive,
  onMove,
  onDelete,
}: CustomerFieldRowProps) => {
  const t = useTranslations("dashboard.settings.customerFields");
  const { ref, handleRef, isDragging } = useSortable({
    id: field.id,
    index,
    group,
    disabled,
    transition: { duration: 160, easing: "cubic-bezier(0.25, 0.46, 0.45, 0.94)", idle: false },
  });
  const Icon = CUSTOMER_FIELD_TYPE_ICONS[field.type];
  const targeting = describeTargeting(field);

  const flags = [
    field.isRequired && t("badges.required"),
    field.isSensitive && t("badges.sensitive"),
    field.showOnContract && t("badges.contract"),
    field.isSearchable && t("badges.search"),
    field.showInList && t("badges.list"),
    field.appliesTo === "business" && t("badges.business"),
    field.appliesTo === "individual" && t("badges.individual"),
  ].filter((badge): badge is string => Boolean(badge));

  return (
    <li
      ref={ref}
      className={cn(
        "bg-card flex items-center gap-2 rounded-lg border p-2 sm:gap-3",
        isDragging && "shadow-raised z-10",
      )}
    >
      <button
        ref={handleRef}
        type="button"
        aria-label={t("field.drag")}
        className="text-muted-foreground hover:text-foreground cursor-grab touch-none rounded-lg p-1 active:cursor-grabbing"
      >
        <GripVertical className="size-4" />
      </button>
      <span className="bg-muted text-muted-foreground flex size-8 shrink-0 items-center justify-center rounded-lg">
        <Icon className="size-4" />
      </span>
      <button type="button" className="min-w-0 flex-1 text-left" onClick={() => onEdit(field)}>
        <span className="block truncate text-sm font-medium">{field.label}</span>
        {/* What it is and which switches are on, in quiet text; then, only when
            there is one, where it applies online, as badges. */}
        <span className="text-muted-foreground mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
          <span className="min-w-0">
            {[t(`dialog.types.${field.type}`), field.unit, ...flags].filter(Boolean).join(" · ")}
          </span>
          {targeting.kind === "targets" && (
            <CustomerFieldTargetSummary targets={targeting.targets} />
          )}
        </span>
        {(field.scope === "item" ||
          field.collectMode !== "never" ||
          targeting.kind === "empty") && (
          <span className="mt-1.5 flex flex-wrap items-center gap-1">
            {field.scope === "item" && (
              <Badge variant="secondary" size="sm">
                <Package aria-hidden />
                {t("badges.item")}
              </Badge>
            )}
            {field.collectMode !== "never" && (
              <Badge variant="info" size="sm">
                <Globe aria-hidden />
                {t(`badges.online.${field.collectMode}`)}
              </Badge>
            )}
            {targeting.kind === "empty" && (
              <Badge variant="warning" size="sm">
                <TriangleAlert aria-hidden />
                {t("badges.noTarget")}
              </Badge>
            )}
          </span>
        )}
      </button>
      <Switch
        aria-label={t("field.active")}
        checked={field.isActive}
        onCheckedChange={(checked) => onSetActive(field, checked)}
      />
      <DropdownMenu>
        <DropdownMenuTrigger
          render={<Button variant="ghost" size="icon" aria-label={t("field.actions")} />}
        >
          <MoreHorizontal className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => onEdit(field)}>{t("field.edit")}</DropdownMenuItem>
          {otherSections.length > 0 && (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>{t("field.moveTo")}</DropdownMenuSubTrigger>
              <DropdownMenuSubContent>
                {otherSections.map((section) => (
                  <DropdownMenuItem key={section} onClick={() => onMove(field, section)}>
                    {section}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            onClick={() => onDelete(field)}
          >
            {t("field.delete")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
};
