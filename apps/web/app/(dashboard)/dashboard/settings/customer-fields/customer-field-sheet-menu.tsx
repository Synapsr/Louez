"use client";

import { MoreHorizontal, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";

import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@louez/ui";

import { useCustomerFieldsBuilder } from "./customer-fields-builder-context";

interface CustomerFieldSheetMenuProps {
  fieldId: string;
  label: string;
}

/** The rare move of a store field, kept out of the way: deleting it (hiding is a switch). */
export const CustomerFieldSheetMenu = ({ fieldId, label }: CustomerFieldSheetMenuProps) => {
  const t = useTranslations("dashboard.settings.customerFields");
  const { requestDelete } = useCustomerFieldsBuilder();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t("builder.field.actions", { label })}
            className="text-muted-foreground"
          />
        }
      >
        <MoreHorizontal className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          className="text-destructive hover:text-destructive data-highlighted:text-destructive"
          onClick={() => requestDelete(fieldId)}
        >
          <Trash2 />
          {t("field.delete")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
