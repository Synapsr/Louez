"use client";

import { CustomerFieldInspectorDraft } from "./customer-field-inspector-draft";
import { CustomerFieldInspectorEmpty } from "./customer-field-inspector-empty";
import { CustomerFieldInspectorField } from "./customer-field-inspector-field";
import { useCustomerFieldsBuilder } from "./customer-fields-builder-context";

/** The selected field's settings, the one being created, or a hint when nothing is selected. */
export const CustomerFieldInspector = () => {
  const { selection, draft, fields } = useCustomerFieldsBuilder();

  if (selection?.kind === "draft" && draft) {
    return <CustomerFieldInspectorDraft key={draft.key} />;
  }
  if (selection?.kind === "field") {
    const field = fields.find((entry) => entry.id === selection.id && entry.isActive);
    if (field) {
      return (
        <CustomerFieldInspectorField
          key={field.id}
          field={field}
          focus={selection.focus}
          request={selection.request}
        />
      );
    }
  }
  return <CustomerFieldInspectorEmpty />;
};
