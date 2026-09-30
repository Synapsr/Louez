"use client";

import { KeyboardSensor, PointerSensor } from "@dnd-kit/react";
import { useSortable } from "@dnd-kit/react/sortable";
import { GripVertical } from "lucide-react";
import { useTranslations } from "next-intl";

import type { CustomerFieldScope } from "@louez/types";

import { CustomerFieldBadges } from "./customer-field-badges";
import { type BuilderItem, useCustomerFieldsBuilder } from "./customer-fields-builder-context";
import { CustomerFormItemPreview } from "./customer-form-item-preview";
import { CustomerFormRowFrame } from "./customer-form-row-frame";
import { CustomerFormWidthToggle } from "./customer-form-width-toggle";
import { useCustomerFormItemLabel } from "./use-customer-form-item-label";
import { customerFormItemFlags } from "./util.customer-form-builder";

interface CustomerFormItemRowProps {
  scope: CustomerFieldScope;
  item: BuilderItem;
  /** Its place among the items the tab shows. */
  index: number;
}

/**
 * A row is grabbed anywhere with a pointer (a plain click still opens it);
 * the grip is where the keyboard picks it up. Controls marked `data-no-drag`
 * (the width toggle) never drag.
 */
const ROW_SENSORS = [
  PointerSensor.configure({
    activatorElements: (source) => [source.element],
    preventActivation: (event) =>
      event.target instanceof Element && event.target.closest("[data-no-drag]") !== null,
  }),
  KeyboardSensor,
];

/**
 * One field of a tab: a click opens its settings, a drag moves it, the
 * corner switches it between half and full row. Read-only members only open it.
 */
export const CustomerFormItemRow = ({ scope, item, index }: CustomerFormItemRowProps) => {
  const t = useTranslations("dashboard.settings.customerFields");
  const { readOnly, selection, selectItem, profileSettings, actions } = useCustomerFieldsBuilder();
  const labelOf = useCustomerFormItemLabel();
  const label = labelOf(item);
  const { ref, handleRef, isDragging } = useSortable({
    id: item.key,
    index,
    group: scope,
    disabled: readOnly,
    sensors: ROW_SENSORS,
    transition: { duration: 160, easing: "cubic-bezier(0.25, 0.46, 0.45, 0.94)", idle: false },
  });

  return (
    <CustomerFormRowFrame
      // Read-only rows are not registered: dnd-kit would turn the whole row into a disabled
      // "draggable" and hide the button inside it from assistive technologies.
      ref={readOnly ? undefined : ref}
      label={label}
      locked={item.locked}
      full={item.width === "full"}
      muted={item.hidden}
      highlighted={
        selection?.kind === "item" && selection.scope === scope && selection.key === item.key
      }
      dragging={isDragging}
      preview={<CustomerFormItemPreview field={item} />}
      badges={<CustomerFieldBadges flags={customerFormItemFlags(item, profileSettings)} />}
      action={{
        label: t("builder.field.select", { label }),
        onClick: () => selectItem(scope, item.key),
      }}
      tools={
        readOnly ? undefined : (
          <>
            <button
              ref={handleRef}
              type="button"
              aria-label={t("field.drag")}
              className="text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-ring flex size-6 cursor-grab touch-none items-center justify-center rounded-md outline-none focus-visible:ring-2 active:cursor-grabbing"
            >
              <GripVertical className="size-4" />
            </button>
            {/* One column on a narrow screen: the width only shows on a wider form. */}
            {!item.fixedWidth && (
              <div data-no-drag className="hidden @md/grid:block">
                <CustomerFormWidthToggle
                  width={item.width}
                  onChange={(width) => actions.setWidth(scope, item.key, width)}
                />
              </div>
            )}
          </>
        )
      }
    />
  );
};
