"use client";

import { useState } from "react";

import { DragDropProvider, type DragEndEvent } from "@dnd-kit/react";
import { isSortable } from "@dnd-kit/react/sortable";
import { ArrowDown, ArrowUp, Globe, MoreHorizontal, Pencil, Plus } from "lucide-react";
import { useTranslations } from "next-intl";

import type { CustomerFieldDefinition } from "@louez/types";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
} from "@louez/ui";

import { DashboardSectionCard } from "@/components/dashboard/shared/dashboard-section-card";

import { CustomerFieldRow, type CustomerFieldRowActions } from "./customer-field-row";
import { moveItem } from "@/lib/customers/util.customer-fields";

interface CustomerFieldSectionCardProps extends CustomerFieldRowActions {
  name: string;
  fields: CustomerFieldDefinition[];
  otherSections: string[];
  isFirst: boolean;
  isLast: boolean;
  disabled: boolean;
  onAddField: (section: string) => void;
  onReorder: (section: string, fields: CustomerFieldDefinition[]) => void;
  onRename: (from: string, to: string) => void;
  onMoveSection: (section: string, direction: -1 | 1) => void;
  /** Opens "Réservation en ligne…" for every field of the section. */
  onOnlineSettings: (section: string) => void;
}

export const CustomerFieldSectionCard = ({
  name,
  fields,
  otherSections,
  isFirst,
  isLast,
  disabled,
  onAddField,
  onReorder,
  onRename,
  onMoveSection,
  onOnlineSettings,
  ...rowActions
}: CustomerFieldSectionCardProps) => {
  const t = useTranslations("dashboard.settings.customerFields");
  const [draftName, setDraftName] = useState<string | null>(null);

  const commitRename = () => {
    const next = draftName?.trim();
    if (next && next !== name) onRename(name, next);
    setDraftName(null);
  };

  const finishReorder = (event: DragEndEvent) => {
    if (event.canceled) return;
    const { source } = event.operation;
    if (!isSortable(source) || source.initialIndex === source.index) return;
    onReorder(name, moveItem(fields, source.initialIndex, source.index));
  };

  return (
    <DashboardSectionCard
      title={name}
      action={
        <DropdownMenu>
          <DropdownMenuTrigger
            render={<Button variant="ghost" size="icon" aria-label={t("sections.actions")} />}
          >
            <MoreHorizontal className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => onOnlineSettings(name)}>
              <Globe className="size-4" />
              {t("sections.online")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => setDraftName(name)}>
              <Pencil className="size-4" />
              {t("sections.rename")}
            </DropdownMenuItem>
            <DropdownMenuItem disabled={isFirst} onClick={() => onMoveSection(name, -1)}>
              <ArrowUp className="size-4" />
              {t("sections.moveUp")}
            </DropdownMenuItem>
            <DropdownMenuItem disabled={isLast} onClick={() => onMoveSection(name, 1)}>
              <ArrowDown className="size-4" />
              {t("sections.moveDown")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      }
    >
      <div className="space-y-3">
        {draftName !== null && (
          <Input
            autoFocus
            aria-label={t("sections.rename")}
            value={draftName}
            maxLength={100}
            onChange={(event) => setDraftName(event.target.value)}
            onBlur={commitRename}
            onKeyDown={(event) => {
              if (event.key === "Enter") commitRename();
              if (event.key === "Escape") setDraftName(null);
            }}
          />
        )}
        <DragDropProvider onDragEnd={finishReorder}>
          <ul className="space-y-2">
            {fields.map((field, index) => (
              <CustomerFieldRow
                key={field.id}
                field={field}
                index={index}
                group={name}
                otherSections={otherSections}
                disabled={disabled}
                {...rowActions}
              />
            ))}
          </ul>
        </DragDropProvider>
        <Button type="button" variant="outline" size="sm" onClick={() => onAddField(name)}>
          <Plus className="size-4" />
          {t("field.add")}
        </Button>
      </div>
    </DashboardSectionCard>
  );
};
