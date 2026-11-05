"use client";

import { useEffect } from "react";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { useStore } from "@tanstack/react-form";
import { useTranslations } from "next-intl";

import type { CustomerFieldValues } from "@louez/types";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@louez/ui";
import { type CustomerFormLayoutItem, selectCustomerFormItems } from "@louez/validations";

import { RootError } from "@/components/form/root-error";
import { trackOpenReplayEvent } from "@/lib/openreplay/client";
import { openReplayEvents } from "@/lib/openreplay/events";

import { CustomerFormFields } from "./customer-form-fields";
import { CustomerFormTypeSwitch } from "./customer-form-type-switch";
import type { CustomerFormCustomer, CustomerFormOpenReplaySource } from "./customer-form.types";
import { useCustomerForm } from "./use-customer-form";

interface CustomerFormProps {
  customer?: CustomerFormCustomer;
  /** The customer form's layout, hidden items left out, both customer types. */
  items: CustomerFormLayoutItem[];
  initialCustomFields?: CustomerFieldValues;
  /** Owners get a shortcut to the field editor. */
  canCustomize: boolean;
  openReplaySource?: CustomerFormOpenReplaySource;
}

export const CustomerForm = ({
  customer,
  items,
  initialCustomFields = {},
  canCustomize,
  openReplaySource = "direct",
}: CustomerFormProps) => {
  const router = useRouter();
  const t = useTranslations("dashboard.customers.form");
  const tCommon = useTranslations("common");
  const isEditing = customer !== undefined;
  const { form, rootError, fieldIssues } = useCustomerForm({
    customer,
    initialCustomFields,
    items,
    save: customer ? { kind: "update", customerId: customer.id } : { kind: "create" },
    onSaved: (customerId) => {
      if (!isEditing) {
        trackOpenReplayEvent(openReplayEvents.dashboardCustomerCreationCompleted, {
          journey: "customer_creation",
          step: "completed",
          source: openReplaySource,
        });
      }
      router.push(`/dashboard/customers/${customerId}`);
    },
  });

  useEffect(() => {
    if (isEditing) return;

    trackOpenReplayEvent(openReplayEvents.dashboardCustomerCreationStarted, {
      journey: "customer_creation",
      step: "started",
      source: openReplaySource,
    });
  }, [isEditing, openReplaySource]);

  const customerType = useStore(form.store, (state) => state.values.customerType);

  return (
    <form.AppForm>
      <form.Form className="space-y-4 sm:space-y-6">
        <RootError error={rootError} />

        <Card>
          <CardHeader>
            <CardTitle>{t("fieldsTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-6">
            <CustomerFormTypeSwitch form={form} />
            <CustomerFormFields
              form={form}
              items={selectCustomerFormItems(items, { customerType })}
              fieldIssues={fieldIssues}
              customerId={customer?.id}
            />
            {canCustomize && (
              <Link
                href="/dashboard/settings/customer-fields"
                className="text-muted-foreground hover:text-foreground justify-self-start text-sm underline underline-offset-2"
              >
                {t("customizeFields")}
              </Link>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t("internalNotes")}</CardTitle>
            <CardDescription>{t("internalNotesDescription")}</CardDescription>
          </CardHeader>
          <CardContent>
            <form.AppField name="notes">
              {(field) => <field.Textarea rows={4} placeholder={t("notesPlaceholder")} />}
            </form.AppField>
          </CardContent>
        </Card>

        <div className="flex justify-end gap-3">
          <Button type="button" variant="outline" onClick={() => router.back()}>
            {tCommon("cancel")}
          </Button>
          <form.SubscribeButton>{isEditing ? t("save") : t("createCustomer")}</form.SubscribeButton>
        </div>
      </form.Form>
    </form.AppForm>
  );
};
