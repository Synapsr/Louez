"use client";

import { useSortable } from "@dnd-kit/react/sortable";
import { GripVertical, MoreHorizontal } from "lucide-react";
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

import { CUSTOMER_FIELD_TYPE_ICONS } from "./customer-field-type-icon";

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

  const badges = [
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
        <span className="text-muted-foreground block truncate text-xs">
          {t(`dialog.types.${field.type}`)}
          {field.unit ? ` · ${field.unit}` : ""}
        </span>
      </button>
      <div className="hidden flex-wrap justify-end gap-1 md:flex">
        {badges.map((badge) => (
          <Badge key={badge} variant="secondary" size="sm">
            {badge}
          </Badge>
        ))}
      </div>
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
