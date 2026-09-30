"use client";

import { FolderInput, MoreHorizontal, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";

import type { CustomerFieldDefinition } from "@louez/types";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@louez/ui";
import { cn } from "@louez/utils";

import { useCustomerFieldsBuilder } from "./customer-fields-builder-context";
import { listScopeSections } from "./util.customer-fields-builder";

interface CustomerFieldMenuProps {
  field: Pick<CustomerFieldDefinition, "id" | "label" | "scope" | "section">;
  className?: string;
}

/**
 * The rarer moves of a store field: to another section of its scope, or away
 * for good. Hiding it is the inspector's "Afficher sur la fiche"; Louez fields
 * have no menu (they cannot move or go).
 */
export const CustomerFieldMenu = ({ field, className }: CustomerFieldMenuProps) => {
  const t = useTranslations("dashboard.settings.customerFields");
  const { fields, localSections, actions, requestDelete } = useCustomerFieldsBuilder();
  const otherSections = listScopeSections(fields, field.scope, localSections)
    .map((section) => section.name)
    .filter((name) => name !== field.section);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t("builder.field.actions", { label: field.label })}
            className={cn("text-muted-foreground", className)}
          />
        }
      >
        <MoreHorizontal className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {otherSections.length > 0 && (
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <FolderInput />
              {t("field.moveTo")}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {otherSections.map((section) => (
                <DropdownMenuItem key={section} onClick={() => actions.moveField(field, section)}>
                  {section}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        )}
        {otherSections.length > 0 && <DropdownMenuSeparator />}
        <DropdownMenuItem
          className="text-destructive hover:text-destructive data-highlighted:text-destructive"
          onClick={() => requestDelete(field.id)}
        >
          <Trash2 />
          {t("field.delete")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
