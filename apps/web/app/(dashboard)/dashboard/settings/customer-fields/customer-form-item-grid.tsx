"use client";

import type { ReactNode } from "react";

import { DragDropProvider, type DragEndEvent } from "@dnd-kit/react";
import { isSortable } from "@dnd-kit/react/sortable";
import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";

import type { CustomerFieldScope } from "@louez/types";
import { Button } from "@louez/ui";

import { type BuilderItem, useCustomerFieldsBuilder } from "./customer-fields-builder-context";
import { CustomerFormDraftRow } from "./customer-form-draft-row";
import { CustomerFormItemRow } from "./customer-form-item-row";

interface CustomerFormItemGridProps {
  scope: CustomerFieldScope;
  /** What the tab shows, in order. */
  items: BuilderItem[];
  /** A fixed first row ("Pour qui ?"): not sortable. */
  leading?: ReactNode;
  /** "Ajouter un champ" under the list; the empty tab offers its own. */
  showAdd: boolean;
}

/**
 * A tab's items as the form lays them out: two columns once there is room,
 * a full-width item alone on its row. One drop, one save; the field being
 * created comes last.
 */
export const CustomerFormItemGrid = ({
  scope,
  items,
  leading,
  showAdd,
}: CustomerFormItemGridProps) => {
  const t = useTranslations("dashboard.settings.customerFields");
  const { readOnly, draft, setPickerOpen, actions } = useCustomerFieldsBuilder();

  const finishMove = (event: DragEndEvent) => {
    if (event.canceled) return;
    const { source } = event.operation;
    if (!isSortable(source)) return;
    actions.moveItem(scope, items, source.initialIndex, source.index);
  };

  return (
    <div className="@container/grid flex flex-col gap-1">
      <DragDropProvider onDragEnd={finishMove}>
        <ul className="grid items-start gap-1 @md/grid:grid-cols-2">
          {leading}
          {items.map((item, index) => (
            <CustomerFormItemRow key={item.key} scope={scope} item={item} index={index} />
          ))}
          {draft?.scope === scope && <CustomerFormDraftRow />}
        </ul>
      </DragDropProvider>
      {showAdd && !readOnly && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-muted-foreground self-start"
          onClick={() => setPickerOpen(true)}
        >
          <Plus />
          {t("field.add")}
        </Button>
      )}
    </div>
  );
};
