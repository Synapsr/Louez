"use client";

import { Archive, ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";

import {
  Button,
  Card,
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
  DisabledControlsProvider,
} from "@louez/ui";

import { CustomerFieldArchivedRow } from "./customer-field-archived-row";
import type { CustomerFieldWithUsage } from "./util.customer-fields-builder";

interface CustomerFieldsArchivedProps {
  fields: CustomerFieldWithUsage[];
}

/** Archived fields wait at the bottom, folded: bringing one back is rare. */
export const CustomerFieldsArchived = ({ fields }: CustomerFieldsArchivedProps) => {
  const t = useTranslations("dashboard.settings.customerFields");

  return (
    <Collapsible className="flex flex-col gap-2">
      {/* Opening the list only changes the view: read-only members may too. */}
      <DisabledControlsProvider disabled={false}>
        <CollapsibleTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="group text-muted-foreground self-start"
            />
          }
        >
          <Archive />
          {t("builder.archived.show", { count: fields.length })}
          <ChevronDown className="transition-transform group-data-panel-open:rotate-180" />
        </CollapsibleTrigger>
      </DisabledControlsProvider>
      <CollapsiblePanel>
        <Card className="p-3 sm:p-4">
          <p className="text-muted-foreground text-sm">{t("archived.description")}</p>
          <ul className="divide-y">
            {fields.map((field) => (
              <CustomerFieldArchivedRow key={field.id} field={field} />
            ))}
          </ul>
        </Card>
      </CollapsiblePanel>
    </Collapsible>
  );
};
