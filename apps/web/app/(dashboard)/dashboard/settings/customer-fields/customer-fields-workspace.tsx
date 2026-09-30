"use client";

import type { ReactNode } from "react";

import { CustomerFieldInspectorDrawer } from "./customer-field-inspector-drawer";
import { CustomerFieldInspectorSheet } from "./customer-field-inspector-sheet";
import { useCustomerFieldsBuilder } from "./customer-fields-builder-context";
import { useInspectorDrawer } from "./use-inspector-drawer";

interface CustomerFieldsWorkspaceProps {
  /** The page: its header (with "Ajouter un champ") and the builder. */
  children: ReactNode;
}

/**
 * The page and the field inspector. The form takes the page's full width;
 * a selected field opens its settings in a drawer on the right, and the whole
 * page (header included) moves over just enough to stay clear of it. On a
 * phone, the settings cover the screen instead.
 */
export const CustomerFieldsWorkspace = ({ children }: CustomerFieldsWorkspaceProps) => {
  const { selection, clearSelection } = useCustomerFieldsBuilder();
  const { frameRef, layout, push } = useInspectorDrawer(selection, clearSelection);

  return (
    <div
      ref={frameRef}
      // The room made for the drawer, measured at run time.
      style={{ paddingInlineEnd: push }}
      className="transition-[padding] duration-200 ease-out motion-reduce:transition-none"
      onKeyDown={(event) => {
        // Escape on the page or in the drawer closes the selection (drops a draft). Keys pressed in
        // a list, a menu or a dialog opened from here are theirs: those live in portals, outside.
        if (event.key !== "Escape" || !(event.target instanceof Node)) return;
        if (event.currentTarget.contains(event.target)) clearSelection();
      }}
    >
      {children}
      {layout?.mode === "side" && <CustomerFieldInspectorDrawer layout={layout} />}
      {layout?.mode === "sheet" && <CustomerFieldInspectorSheet open={selection !== null} />}
    </div>
  );
};
