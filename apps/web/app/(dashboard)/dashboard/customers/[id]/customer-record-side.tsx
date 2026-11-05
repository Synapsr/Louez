"use client";

import { useState } from "react";

import { Pencil } from "lucide-react";
import { useTranslations } from "next-intl";

import type { CustomerFieldValues } from "@louez/types";
import { Button } from "@louez/ui";
import { type CustomerFormLayoutItem, selectCustomerFormItems } from "@louez/validations";

import { DashboardSectionCard } from "@/components/dashboard/shared/dashboard-section-card";

import { isCustomerRecordItemFilled, listCustomerRecordItems } from "../util.customer-form";
import { CustomerRecordItemLabel } from "./customer-record-item-label";
import { CustomerRecordItemValue } from "./customer-record-item-value";
import { CustomerRecordRow } from "./customer-record-row";
import { CustomerRecordSheet } from "./customer-record-sheet";
import type { CustomerRecord } from "./customer-record.types";

interface CustomerRecordSideProps {
  customer: CustomerRecord;
  /** The customer form's layout, hidden items left out, both customer types. */
  items: CustomerFormLayoutItem[];
  customFields: CustomerFieldValues;
  storeCountry: string;
  locale: string;
  /** Landing demos: the record is shown, never edited. */
  readOnly?: boolean;
}

/**
 * "Informations": everything filled in on the record, in the owner's layout
 * (the header already names the customer), and one Sheet to edit it all.
 */
export const CustomerRecordSide = ({
  customer,
  items,
  customFields,
  storeCountry,
  locale,
  readOnly = false,
}: CustomerRecordSideProps) => {
  const t = useTranslations("dashboard.customers");
  const [isEditing, setIsEditing] = useState(false);

  const recordItems = listCustomerRecordItems(
    selectCustomerFormItems(items, { customerType: customer.customerType }),
  );
  const filled = recordItems.filter((item) =>
    isCustomerRecordItemFilled(item, customer, customFields),
  );
  const missing = recordItems.length - filled.length;
  const title = t("detail.infoCard");

  return (
    <div className="min-w-0 space-y-4">
      <DashboardSectionCard
        title={title}
        action={
          readOnly ? undefined : (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t("detail.editSection", { section: title })}
              onClick={() => setIsEditing(true)}
            >
              <Pencil className="size-3.5" />
            </Button>
          )
        }
      >
        <div className="space-y-3">
          {filled.length > 0 ? (
            <dl className="space-y-2.5">
              {filled.map((item) => (
                <CustomerRecordRow
                  key={item.key}
                  label={<CustomerRecordItemLabel item={item} country={customer.country} />}
                >
                  <CustomerRecordItemValue
                    item={item}
                    customer={customer}
                    customFields={customFields}
                    storeCountry={storeCountry}
                    locale={locale}
                    readOnly={readOnly}
                  />
                </CustomerRecordRow>
              ))}
            </dl>
          ) : (
            <p className="text-muted-foreground text-sm">{t("detail.emptyInfo")}</p>
          )}
          {missing > 0 && !readOnly && (
            <Button
              type="button"
              variant="link"
              size="sm"
              className="h-auto p-0"
              onClick={() => setIsEditing(true)}
            >
              {t("fields.complete", { count: missing })}
            </Button>
          )}
        </div>
      </DashboardSectionCard>

      {isEditing && (
        <CustomerRecordSheet
          customer={customer}
          items={recordItems}
          customFields={customFields}
          onClose={() => setIsEditing(false)}
        />
      )}
    </div>
  );
};
