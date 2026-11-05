"use client";

import type { CustomerFormLayoutItem, CustomerFieldIssueCode } from "@louez/validations";
import { cn } from "@louez/utils";

import { CustomerFormBuiltInField } from "./customer-form-built-in-field";
import { CustomerFormCustomField } from "./customer-form-custom-field";
import type { CustomerFormApi } from "./use-customer-form";

interface CustomerFormFieldsProps {
  form: CustomerFormApi;
  /** In layout order, already narrowed to the customer type, hidden ones left out. */
  items: readonly CustomerFormLayoutItem[];
  fieldIssues: Record<string, CustomerFieldIssueCode>;
  /** Record being edited, left out of the duplicate lookups. */
  customerId?: string;
}

/**
 * The customer's fields as the owner laid them out (Settings → Fiche client):
 * one grid, two columns from `sm`, a full-width item on its own row.
 */
export const CustomerFormFields = ({
  form,
  items,
  fieldIssues,
  customerId,
}: CustomerFormFieldsProps) => (
  <div className="grid items-start gap-4 sm:grid-cols-2">
    {items.map((item) => (
      <div key={item.key} className={cn("min-w-0", item.width === "full" && "sm:col-span-2")}>
        {item.kind === "builtin" ? (
          <CustomerFormBuiltInField form={form} item={item} />
        ) : (
          <CustomerFormCustomField
            form={form}
            definition={item.definition}
            issue={fieldIssues[item.definition.id]}
            customerId={customerId}
          />
        )}
      </div>
    ))}
  </div>
);
