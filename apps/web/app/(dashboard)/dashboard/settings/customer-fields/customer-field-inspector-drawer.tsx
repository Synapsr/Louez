"use client";

import { useEffect, useRef, useState } from "react";

import { useTranslations } from "next-intl";

import { cn } from "@louez/utils";

import { CustomerFieldInspector } from "./customer-field-inspector";
import { useCustomerFieldsBuilder } from "./customer-fields-builder-context";
import type { InspectorDrawerLayout } from "./util.inspector-drawer-layout";

interface CustomerFieldInspectorDrawerProps {
  layout: Extract<InspectorDrawerLayout, { mode: "side" }>;
}

/**
 * The inspector as a drawer on the right of the dashboard panel, with no
 * backdrop: the form beside it stays in view and clickable, and a click on
 * another field swaps what the drawer shows. Escape and × close it.
 */
export const CustomerFieldInspectorDrawer = ({ layout }: CustomerFieldInspectorDrawerProps) => {
  const t = useTranslations("dashboard.settings.customerFields.builder.inspector");
  const { selection } = useCustomerFieldsBuilder();
  const panelRef = useRef<HTMLElement>(null);
  const open = selection !== null;

  // While it slides away the drawer keeps showing the field it was showing, then lets go of it.
  const [shown, setShown] = useState(selection);
  if (selection !== null && selection !== shown) setShown(selection);

  // Picked with the keyboard, the field's settings take the focus: they sit at the page's end.
  const focusRequest =
    selection && selection.kind !== "draft" && selection.fromKeyboard ? selection.request : null;
  useEffect(() => {
    if (focusRequest !== null) panelRef.current?.focus();
  }, [focusRequest]);

  return (
    <aside
      ref={panelRef}
      tabIndex={-1}
      aria-label={t("label")}
      data-field-inspector=""
      inert={!open}
      // Measured from the dashboard panel at run time.
      style={{ top: layout.top, right: layout.right, bottom: layout.bottom, width: layout.width }}
      className={cn(
        "bg-card shadow-overlay fixed z-40 flex flex-col overflow-hidden rounded-2xl border outline-none",
        "duration-200 ease-out motion-reduce:transition-none",
        // Visible at once when it opens, so focus can land in it; hidden only once it has slid away.
        open
          ? "visible translate-x-0 opacity-100 transition-[translate,opacity]"
          : "invisible translate-x-4 opacity-0 transition-[translate,opacity,visibility]",
      )}
      onTransitionEnd={(event) => {
        if (!open && event.target === event.currentTarget && event.propertyName === "opacity") {
          setShown(null);
        }
      }}
    >
      <CustomerFieldInspector selection={selection ?? shown} />
    </aside>
  );
};
