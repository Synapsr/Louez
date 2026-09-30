"use client";

import { useSortable } from "@dnd-kit/react/sortable";
import { GripVertical } from "lucide-react";
import { useTranslations } from "next-intl";

import { cn } from "@louez/utils";

import { CustomerFieldControl } from "@/components/dashboard/customers/customer-field-control";

import { CustomerFieldBadges } from "./customer-field-badges";
import { CustomerFieldMenu } from "./customer-field-menu";
import { useCustomerFieldsBuilder } from "./customer-fields-builder-context";
import type { CustomerFieldWithUsage } from "./util.customer-fields-builder";

interface CustomerFieldCanvasRowProps {
  field: CustomerFieldWithUsage;
  index: number;
  /** Sortable group: a field is dragged within its own section. */
  group: string;
  selected: boolean;
  onSelect: () => void;
}

/** The inputs are there to be looked at: nothing to type in the canvas. */
const ignoreChange = () => undefined;

/**
 * One field as the team meets it on the customer form, with what the owner
 * needs around it: a click selects it, the handle drags it, "⋯" moves or
 * archives it. The handle and "⋯" wait for the pointer (always there on touch).
 */
export const CustomerFieldCanvasRow = ({
  field,
  index,
  group,
  selected,
  onSelect,
}: CustomerFieldCanvasRowProps) => {
  const t = useTranslations("dashboard.settings.customerFields");
  const { readOnly } = useCustomerFieldsBuilder();
  const { ref, handleRef, isDragging } = useSortable({
    id: field.id,
    index,
    group,
    disabled: readOnly,
    transition: { duration: 160, easing: "cubic-bezier(0.25, 0.46, 0.45, 0.94)", idle: false },
  });

  return (
    <li
      // Read-only rows have no handle: registered anyway, dnd-kit would make the whole row a
      // disabled "draggable" button and hide the selection button inside it from assistive tech.
      ref={readOnly ? undefined : ref}
      className={cn(
        "group/field relative rounded-xl transition-colors",
        selected ? "bg-primary/5 ring-2 ring-primary/50" : "hover:bg-muted/60",
        isDragging && "bg-card shadow-raised z-10",
      )}
    >
      <button
        type="button"
        aria-pressed={selected}
        aria-label={t("builder.field.select", { label: field.label })}
        className="absolute inset-0 cursor-pointer rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={onSelect}
      />
      <div
        className={cn(
          "pointer-events-none relative flex items-start gap-1 py-3 ps-1 pe-2 pointer-coarse:pe-9",
          // A yes/no field is a box with its switch at the end: "⋯" needs its own room there.
          field.type === "checkbox" && "pe-9",
        )}
      >
        {readOnly ? (
          <span aria-hidden className="w-6 shrink-0" />
        ) : (
          <button
            ref={handleRef}
            type="button"
            aria-label={t("field.drag")}
            className="text-muted-foreground hover:text-foreground focus-visible:ring-ring pointer-events-auto flex size-6 shrink-0 cursor-grab touch-none items-center justify-center rounded-md opacity-0 transition-opacity outline-none group-hover/field:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 active:cursor-grabbing pointer-coarse:opacity-100"
          >
            <GripVertical className="size-4" />
          </button>
        )}
        <div inert className="min-w-0 flex-1">
          <CustomerFieldControl
            preview
            definition={field}
            value=""
            inputId={`canvas-${field.id}`}
            onChange={ignoreChange}
          />
          <CustomerFieldBadges field={field} />
        </div>
      </div>
      {/* On the label's line, over the row: the input keeps the form's full width. */}
      {!readOnly && (
        <div className="absolute end-1.5 top-2 opacity-0 transition-opacity group-hover/field:opacity-100 focus-within:opacity-100 has-data-popup-open:opacity-100 pointer-coarse:opacity-100">
          <CustomerFieldMenu field={field} className="bg-card/90 size-7" />
        </div>
      )}
    </li>
  );
};
