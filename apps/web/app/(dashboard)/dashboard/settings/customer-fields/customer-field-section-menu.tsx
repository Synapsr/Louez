"use client";

import { ArrowDown, ArrowUp, Globe, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";

import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@louez/ui";

interface CustomerFieldSectionMenuProps {
  name: string;
  /** Saved fields in it: online settings and moves apply. */
  hasFields: boolean;
  /** A section created on the page and still empty (no field, no draft) can go. */
  canDelete: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onOnlineSettings: () => void;
  onRename: () => void;
  onMove: (direction: -1 | 1) => void;
  onDelete: () => void;
}

/** A section's rarer actions: its online settings in one go, its name, its place. */
export const CustomerFieldSectionMenu = ({
  name,
  hasFields,
  canDelete,
  canMoveUp,
  canMoveDown,
  onOnlineSettings,
  onRename,
  onMove,
  onDelete,
}: CustomerFieldSectionMenuProps) => {
  const t = useTranslations("dashboard.settings.customerFields");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={t("builder.sections.actions", { name })}
            className="text-muted-foreground shrink-0"
          />
        }
      >
        <MoreHorizontal className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {hasFields && (
          <>
            <DropdownMenuItem onClick={onOnlineSettings}>
              <Globe />
              {t("sections.online")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem onClick={onRename}>
          <Pencil />
          {t("sections.rename")}
        </DropdownMenuItem>
        {hasFields && (
          <>
            <DropdownMenuItem disabled={!canMoveUp} onClick={() => onMove(-1)}>
              <ArrowUp />
              {t("sections.moveUp")}
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!canMoveDown} onClick={() => onMove(1)}>
              <ArrowDown />
              {t("sections.moveDown")}
            </DropdownMenuItem>
          </>
        )}
        {canDelete && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive hover:text-destructive data-highlighted:text-destructive"
              onClick={onDelete}
            >
              <Trash2 />
              {t("builder.sections.delete")}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};
