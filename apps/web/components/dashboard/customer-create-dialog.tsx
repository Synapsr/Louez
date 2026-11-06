"use client";

import { useEffect, useMemo } from "react";

import { revalidateLogic } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
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
import { type CustomerType, createCustomerSchema } from "@louez/validations";

import { createCustomer } from "@/app/(dashboard)/dashboard/customers/actions";

import { CustomerSimilarHint } from "@/components/dashboard/customers/customer-similar-hint";
import { RootError } from "@/components/form/root-error";

import { useAppForm } from "@/hooks/form/form";

import type { DashboardCustomer } from "./customer.types";
import type { CustomerQueryPrefill } from "./util.customer-query";

interface CustomerCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Values guessed from the search query the user already typed. */
  prefill: CustomerQueryPrefill;
  onCreated: (customer: DashboardCustomer) => void;
}

interface QuickCustomerValues {
  customerType: CustomerType;
  email?: string;
  firstName: string;
  lastName: string;
  phone?: string;
}

const toFormValues = (prefill: CustomerQueryPrefill): QuickCustomerValues => ({
  ...prefill,
  customerType: "individual",
});

export const CustomerCreateDialog = ({
  open,
  onOpenChange,
  prefill,
  onCreated,
}: CustomerCreateDialogProps) => {
  const t = useTranslations("dashboard.customers");
  const tCommon = useTranslations("common");
  const tErrors = useTranslations("errors");
  const tValidation = useTranslations("validation");

  const customerSchema = useMemo(() => createCustomerSchema(tValidation), [tValidation]);

  const createCustomerMutation = useMutation({
    mutationFn: async (values: QuickCustomerValues) => {
      const customer = {
        email: values.email?.trim().toLowerCase() || null,
        firstName: values.firstName.trim(),
        lastName: values.lastName.trim(),
        phone: values.phone?.trim() || null,
      };

      const result = await createCustomer({
        ...customer,
        customerType: values.customerType,
        email: customer.email ?? undefined,
        phone: customer.phone ?? undefined,
      });

      if (result.error || !result.customerId) {
        throw new Error(result.error ?? "errors.createCustomerError");
      }

      return { id: result.customerId, ...customer } satisfies DashboardCustomer;
    },
  });

  const form = useAppForm({
    defaultValues: toFormValues(prefill),
    validationLogic: revalidateLogic({
      mode: "submit",
      modeAfterSubmission: "change",
    }),
    validators: {
      onSubmit: customerSchema,
    },
    onSubmit: async ({ value }) => {
      const customer = await createCustomerMutation.mutateAsync(value).catch(() => null);

      if (!customer) return;

      onCreated(customer);
      onOpenChange(false);
    },
  });

  // The dialog stays mounted between openings: restart from the current prefill each time.
  useEffect(() => {
    if (!open) return;

    createCustomerMutation.reset();
    form.reset(toFormValues(prefill));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-seed when the dialog opens
  }, [open]);

  const submitError = createCustomerMutation.error;
  const submitErrorMessage = !submitError
    ? null
    : submitError.message.startsWith("errors.")
      ? tErrors(submitError.message.replace("errors.", ""))
      : submitError.message;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="sm:max-w-lg">
        <form.AppForm>
          <form.Form className="flex min-h-0 flex-col" formName="customer-quick-create">
            <DialogHeader>
              <DialogTitle>{t("quickCreate.title")}</DialogTitle>
              <DialogDescription>{t("quickCreate.description")}</DialogDescription>
            </DialogHeader>

            <DialogPanel className="space-y-4">
              <RootError error={submitErrorMessage} />

              <div className="grid gap-4 sm:grid-cols-2">
                <form.AppField name="firstName">
                  {(field) => (
                    <field.Input
                      autoFocus
                      label={t("form.firstName")}
                      placeholder={t("form.firstNamePlaceholder")}
                    />
                  )}
                </form.AppField>

                <form.AppField name="lastName">
                  {(field) => (
                    <field.Input
                      label={t("form.lastName")}
                      placeholder={t("form.lastNamePlaceholder")}
                    />
                  )}
                </form.AppField>
              </div>

              <form.AppField name="email">
                {(field) => (
                  <field.Input
                    label={t("form.emailOptional")}
                    placeholder={t("form.emailPlaceholder")}
                    type="email"
                  />
                )}
              </form.AppField>

              <form.AppField name="phone">
                {(field) => (
                  <field.PhoneInput
                    label={t("form.phone")}
                    placeholder={t("form.phonePlaceholder")}
                  />
                )}
              </form.AppField>
              <p className="text-muted-foreground text-sm">{t("form.contactHint")}</p>
              <form.Subscribe
                selector={(state) => ({
                  email: state.values.email ?? "",
                  phone: state.values.phone ?? "",
                  lastName: state.values.lastName,
                })}
              >
                {(contact) => <CustomerSimilarHint {...contact} />}
              </form.Subscribe>
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
