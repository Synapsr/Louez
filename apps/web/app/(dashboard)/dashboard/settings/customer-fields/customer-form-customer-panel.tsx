"use client";

import { Card } from "@louez/ui";

import { useCustomerFieldsBuilder } from "./customer-fields-builder-context";
import { CustomerFormItemGrid } from "./customer-form-item-grid";
import { CustomerFormTypePreview } from "./customer-form-type-preview";
import { selectBuilderItems } from "./util.customer-form-builder";

/** "Fiche client": the customer form itself, the customer type on top, then every field. */
export const CustomerFormCustomerPanel = () => {
  const { items, customerType } = useCustomerFieldsBuilder();

  return (
    <Card className="gap-3 p-2 sm:p-3">
      <CustomerFormTypePreview />
      <CustomerFormItemGrid
        scope="customer"
        items={selectBuilderItems(items.customer, { scope: "customer", customerType })}
        showAdd
      />
    </Card>
  );
};
