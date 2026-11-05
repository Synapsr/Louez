"use client";

import { Card } from "@louez/ui";

import { useCustomerFieldsBuilder } from "./customer-fields-builder-context";
import { CustomerFormItemEmpty } from "./customer-form-item-empty";
import { CustomerFormItemGrid } from "./customer-form-item-grid";
import { CustomerFormParticipantRow } from "./customer-form-participant-row";

/**
 * "Par article loué": what is asked for each rented item, as its card reads
 * on the reservation. "Pour qui ?" always comes first.
 */
export const CustomerFormItemPanel = () => {
  const { items, draft } = useCustomerFieldsBuilder();
  const isEmpty = items.item.length === 0 && draft?.scope !== "item";

  return (
    <Card className="gap-3 p-2 sm:p-3">
      <CustomerFormItemGrid
        scope="item"
        items={items.item}
        leading={<CustomerFormParticipantRow />}
        showAdd={!isEmpty}
      />
      {isEmpty && <CustomerFormItemEmpty />}
    </Card>
  );
};
