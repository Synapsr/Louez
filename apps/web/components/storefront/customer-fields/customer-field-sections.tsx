"use client";

import { Fragment, type ReactNode } from "react";

import { groupFieldsBySection } from "@/lib/customers/util.customer-fields";

import type { StorefrontSectionedField } from "./customer-fields.types";

interface CustomerFieldSectionsProps<TField extends StorefrontSectionedField> {
  fields: readonly TField[];
  /** The input of one field: bound to a form, or static in the owner preview. */
  renderField: (field: TField) => ReactNode;
}

/**
 * Custom fields under their section titles, in the owner's order (the drag
 * and drop of Settings → Customer record decides it).
 */
export const CustomerFieldSections = <TField extends StorefrontSectionedField>({
  fields,
  renderField,
}: CustomerFieldSectionsProps<TField>) => (
  <>
    {groupFieldsBySection(fields).map((section) => (
      <section key={section.name} className="flex flex-col gap-4">
        <h3 className="text-base font-semibold leading-tight">{section.name}</h3>
        {section.fields.map((field) => (
          <Fragment key={field.id}>{renderField(field)}</Fragment>
        ))}
      </section>
    ))}
  </>
);
