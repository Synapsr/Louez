"use client";

import { useEffect } from "react";

import { useStore } from "@tanstack/react-form";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";

import {
  Button,
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "@louez/ui";
import { resolveStoreCustomerFormLayout, selectCustomerFormItems } from "@louez/validations";

import { CustomerFormFields } from "@/app/(dashboard)/dashboard/customers/customer-form-fields";
import { CustomerFormTypeSwitch } from "@/app/(dashboard)/dashboard/customers/customer-form-type-switch";
import { useCustomerForm } from "@/app/(dashboard)/dashboard/customers/use-customer-form";

import { RootError } from "@/components/form/root-error";

import { orpc } from "@/lib/orpc/react";

import type { DashboardCustomer } from "./customer.types";
import type { CustomerQueryPrefill } from "./util.customer-query";
import { selectQuickCreateItems } from "./util.customer-quick-create";

interface CustomerCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Values guessed from the search query the user already typed. */
  prefill: CustomerQueryPrefill;
  onCreated: (customer: DashboardCustomer) => void;
}

/** Until the store's layout loads: the Louez fields in their default order. */
const DEFAULT_ITEMS = resolveStoreCustomerFormLayout({
  settings: null,
  scope: "customer",
  definitions: [],
});

/**
 * A new customer without leaving the reservation, in seconds: identity, contact
 * and whatever the store made required, in the customer form's order and widths.
 * Everything else is completed later on the record.
 */
export const CustomerCreateDialog = ({
  open,
  onOpenChange,
  prefill,
  onCreated,
}: CustomerCreateDialogProps) => {
  const t = useTranslations("dashboard.customers");
  const tCommon = useTranslations("common");
  const { data: layout } = useQuery(
    orpc.dashboard.customerFields.layout.queryOptions({ input: { scope: "customer" } }),
  );
  const items = layout ? selectCustomerFormItems(layout) : DEFAULT_ITEMS;

  const { form, rootError, fieldIssues, reset } = useCustomerForm({
    initialCustomFields: {},
    items,
    save: { kind: "create" },
    onSaved: (customerId, values) => {
      onCreated({
        id: customerId,
        email: values.email,
        firstName: values.firstName.trim(),
        lastName: values.lastName.trim(),
        phone: values.phone.trim() || null,
      });
      onOpenChange(false);
    },
  });
  const customerType = useStore(form.store, (state) => state.values.customerType);

  // The dialog stays mounted between openings: restart from the current prefill each time.
  useEffect(() => {
    if (!open) return;

    reset(prefill);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-seed when the dialog opens
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="sm:max-w-2xl">
        <form.AppForm>
          <form.Form className="flex min-h-0 flex-col" formName="customer-quick-create">
            <DialogHeader>
              <DialogTitle>{t("quickCreate.title")}</DialogTitle>
              <DialogDescription>{t("quickCreate.description")}</DialogDescription>
            </DialogHeader>

            <DialogPanel className="space-y-6">
              <RootError error={rootError} />
              <CustomerFormTypeSwitch form={form} />
              <CustomerFormFields
                form={form}
                items={selectQuickCreateItems(selectCustomerFormItems(items, { customerType }))}
                fieldIssues={fieldIssues}
              />
            </DialogPanel>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {tCommon("cancel")}
              </Button>
              <form.SubscribeButton>{t("form.createCustomer")}</form.SubscribeButton>
            </DialogFooter>
          </form.Form>
        </form.AppForm>
      </DialogPopup>
    </Dialog>
  );
};
