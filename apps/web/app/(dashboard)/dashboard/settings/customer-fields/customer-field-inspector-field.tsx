"use client";

import { useEffect, useRef } from "react";

import { CustomerFieldInspectorHeader } from "./customer-field-inspector-header";
import { CustomerFieldMenu } from "./customer-field-menu";
import { CustomerFieldSettingsBody } from "./customer-field-settings-body";
import { type InspectorFocus, useCustomerFieldsBuilder } from "./customer-fields-builder-context";
import { useCustomerFieldAutosave } from "./use-customer-field-autosave";
import { type CustomerFieldWithUsage, toSettingsValues } from "./util.customer-fields-builder";

interface CustomerFieldInspectorFieldProps {
  field: CustomerFieldWithUsage;
  focus: InspectorFocus;
  /** Changes on every click on the field, so the same focus scrolls again. */
  request: number;
}

/** Room left above "Réservation en ligne" once scrolled to: its title and a little air. */
const ONLINE_SCROLL_OFFSET = 56;

/** A saved field: every change is saved as it is made, no Save button. Mounted per field. */
export const CustomerFieldInspectorField = ({
  field,
  focus,
  request,
}: CustomerFieldInspectorFieldProps) => {
  const { readOnly, clearSelection } = useCustomerFieldsBuilder();
  const autosave = useCustomerFieldAutosave(field);
  const bodyRef = useRef<HTMLDivElement>(null);
  const onlineRef = useRef<HTMLParagraphElement>(null);

  // Picked from the client view: bring "Réservation en ligne" into sight in the panel only.
  useEffect(() => {
    const body = bodyRef.current;
    const anchor = onlineRef.current;
    if (focus !== "online" || !body || !anchor) return;
    body.scrollTo({
      top:
        body.scrollTop +
        anchor.getBoundingClientRect().top -
        body.getBoundingClientRect().top -
        ONLINE_SCROLL_OFFSET,
      behavior: "smooth",
    });
  }, [focus, request]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <CustomerFieldInspectorHeader
        title={field.label}
        type={field.type}
        scope={field.scope}
        status={autosave.status}
        menu={readOnly ? null : <CustomerFieldMenu field={field} />}
        onClose={clearSelection}
      />
      <div ref={bodyRef} className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
        <CustomerFieldSettingsBody
          idPrefix={`inspector-${field.id}`}
          scope={field.scope}
          type={field.type}
          values={toSettingsValues(field)}
          textMode="commit"
          onChange={autosave.change}
          errorFor={autosave.errorFor}
          onlineRef={onlineRef}
        />
      </div>
    </div>
  );
};
