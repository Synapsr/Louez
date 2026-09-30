"use client";

import { useQuery } from "@tanstack/react-query";

import { CustomerFieldInspectorDraft } from "./customer-field-inspector-draft";
import { CustomerFieldInspectorField } from "./customer-field-inspector-field";
import { type BuilderSelection, useCustomerFieldsBuilder } from "./customer-fields-builder-context";
import { customerProfileSettingsOptions } from "./customer-fields.queries";
import { CustomerProfileFieldInspector } from "./customer-profile-field-inspector";

interface CustomerFieldInspectorProps {
  /** What to show: the current selection, or the last one while the drawer slides away. */
  selection: BuilderSelection;
}

/** The settings of a store field, a Louez field or the field being created: one inspector for all. */
export const CustomerFieldInspector = ({ selection }: CustomerFieldInspectorProps) => {
  const { draft, fields } = useCustomerFieldsBuilder();
  const { data: profileSettings } = useQuery(customerProfileSettingsOptions());

  switch (selection?.kind) {
    case "draft":
      return draft ? <CustomerFieldInspectorDraft key={draft.key} /> : null;
    case "field": {
      const field = fields.find((entry) => entry.id === selection.id);
      return field ? (
        <CustomerFieldInspectorField
          key={field.id}
          field={field}
          focus={selection.focus}
          request={selection.request}
        />
      ) : null;
    }
    case "profile": {
      const settings = profileSettings?.[selection.key];
      return settings ? (
        <CustomerProfileFieldInspector
          key={selection.key}
          field={selection.key}
          settings={settings}
          focus={selection.focus}
          request={selection.request}
        />
      ) : null;
    }
    default:
      return null;
  }
};
