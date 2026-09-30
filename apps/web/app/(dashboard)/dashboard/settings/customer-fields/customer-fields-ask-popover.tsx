"use client";

import { useState } from "react";

import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button, Popover, PopoverPopup, PopoverTrigger } from "@louez/ui";

import { CustomerFieldAskRow } from "./customer-field-ask-row";
import { useCustomerFieldsBuilder } from "./customer-fields-builder-context";
import { listAskableFields } from "./util.customer-fields-builder";

interface CustomerFieldsAskPopoverProps {
  className?: string;
}

/**
 * "Demander un champ au client": the fields the checkout does not ask yet,
 * one click each (asked as optional, shown in the preview at once). The
 * finer settings stay in the inspector.
 */
export const CustomerFieldsAskPopover = ({ className }: CustomerFieldsAskPopoverProps) => {
  const t = useTranslations("dashboard.settings.customerFields");
  const { fields, actions } = useCustomerFieldsBuilder();
  const [justAsked, setJustAsked] = useState<ReadonlySet<string>>(new Set());
  const { customer, item } = listAskableFields(fields, justAsked);
  const groups = [
    { scope: "customer" as const, fields: customer },
    { scope: "item" as const, fields: item },
  ].filter((group) => group.fields.length > 0);

  return (
    <Popover onOpenChange={(open) => !open && setJustAsked(new Set())}>
      <PopoverTrigger render={<Button type="button" variant="outline" className={className} />}>
        <Plus />
        {t("builder.client.ask")}
      </PopoverTrigger>
      <PopoverPopup align="end" className="w-[min(22rem,calc(100vw-2rem))]">
        <div className="flex flex-col gap-3 p-2">
          <div className="flex flex-col gap-0.5">
            <p className="text-sm font-semibold">{t("builder.client.askTitle")}</p>
            <p className="text-muted-foreground text-xs">{t("builder.client.askDescription")}</p>
          </div>
          {groups.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t("builder.client.askEmpty")}</p>
          ) : (
            groups.map((group) => (
              <div key={group.scope} className="flex flex-col gap-1">
                <p className="text-muted-foreground text-xs font-medium">
                  {t(`dialog.scopes.${group.scope}`)}
                </p>
                <ul className="flex flex-col">
                  {group.fields.map((field) => (
                    <CustomerFieldAskRow
                      key={field.id}
                      field={field}
                      onAsk={() => {
                        actions.askCustomer(field);
                        setJustAsked((current) => new Set([...current, field.id]));
                      }}
                    />
                  ))}
                </ul>
              </div>
            ))
          )}
        </div>
      </PopoverPopup>
    </Popover>
  );
};
