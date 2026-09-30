"use client";

import { useSortable } from "@dnd-kit/react/sortable";
import { GripVertical } from "lucide-react";
import { useTranslations } from "next-intl";

import { CustomerFieldControl } from "@/components/dashboard/customers/customer-field-control";

import { CustomerFieldBadges } from "./customer-field-badges";
import { CustomerFieldMenu } from "./customer-field-menu";
import { CustomerFieldRowFrame } from "./customer-field-row-frame";
import { useCustomerFieldsBuilder } from "./customer-fields-builder-context";
import {
  type CanvasFieldRef,
  customFieldFlags,
  isSameCanvasField,
  toCanvasFieldKey,
} from "./util.customer-field-canvas";
import type { CustomerFieldWithUsage } from "./util.customer-fields-builder";

interface CustomerFieldCanvasRowProps {
  field: CustomerFieldWithUsage;
  index: number;
  /** Sortable group: a field is dragged within its own section. */
  group: string;
}

/** The inputs are there to be looked at: nothing to type in the canvas. */
const ignoreChange = () => undefined;

/**
 * One of the store's fields as the team meets it on the form, with what the
 * owner needs around it: the handle drags it, "⋯" moves or deletes it. Hidden,
 * it stays in its place, greyed.
 */
export const CustomerFieldCanvasRow = ({ field, index, group }: CustomerFieldCanvasRowProps) => {
  const t = useTranslations("dashboard.settings.customerFields");
  const { readOnly, selection, selectField } = useCustomerFieldsBuilder();
  const { ref, handleRef, isDragging } = useSortable({
    id: field.id,
    index,
    group,
    disabled: readOnly,
    transition: { duration: 160, easing: "cubic-bezier(0.25, 0.46, 0.45, 0.94)", idle: false },
  });
  const fieldRef: CanvasFieldRef = { kind: "field", id: field.id };

  return (
    <CustomerFieldRowFrame
      // Read-only rows have no handle: registered anyway, dnd-kit would make the whole row a
      // disabled "draggable" button and hide the selection button inside it from assistive tech.
      ref={readOnly ? undefined : ref}
      canvasKey={toCanvasFieldKey(fieldRef)}
      selectLabel={t("builder.field.select", { label: field.label })}
      selected={isSameCanvasField(selection, fieldRef)}
      muted={!field.isActive}
      isDragging={isDragging}
      wideInput={field.type === "checkbox"}
      onSelect={(event) => selectField(fieldRef, { fromKeyboard: event.detail === 0 })}
      handle={
        readOnly ? undefined : (
          <button
            ref={handleRef}
            type="button"
            aria-label={t("field.drag")}
            className="text-muted-foreground hover:text-foreground focus-visible:ring-ring pointer-events-auto flex size-6 shrink-0 cursor-grab touch-none items-center justify-center rounded-md opacity-0 transition-opacity outline-none group-hover/field:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 active:cursor-grabbing pointer-coarse:opacity-100"
          >
            <GripVertical className="size-4" />
          </button>
        )
      }
      menu={
        readOnly ? undefined : <CustomerFieldMenu field={field} className="bg-card/90 size-7" />
      }
      preview={
        <CustomerFieldControl
          preview
          definition={field}
          value=""
          inputId={`canvas-${field.id}`}
          onChange={ignoreChange}
        />
      }
      badges={<CustomerFieldBadges flags={customFieldFlags(field)} />}
    />
  );
};
