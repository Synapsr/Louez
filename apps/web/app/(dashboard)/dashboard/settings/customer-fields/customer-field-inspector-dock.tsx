"use client";

import { useTranslations } from "next-intl";

import { CustomerFieldInspector } from "./customer-field-inspector";
import { CustomerFieldInspectorEmpty } from "./customer-field-inspector-empty";

interface CustomerFieldInspectorDockProps {
  /** False until the editor is known to be wide enough: the column then only shows its hint. */
  active: boolean;
}

/**
 * The inspector docked beside the canvas on wide screens: it stays in view
 * while the form scrolls, and scrolls on its own.
 */
export const CustomerFieldInspectorDock = ({ active }: CustomerFieldInspectorDockProps) => {
  const t = useTranslations("dashboard.settings.customerFields.builder.inspector");

  return (
    <aside
      aria-label={t("label")}
      className="bg-card shadow-card sticky top-4 flex max-h-[calc(100dvh-7.5rem)] min-h-72 flex-col overflow-hidden rounded-2xl"
    >
      {active ? <CustomerFieldInspector /> : <CustomerFieldInspectorEmpty />}
    </aside>
  );
};
