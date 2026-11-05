"use client";

import { useStore } from "@tanstack/react-form";
import { useTranslations } from "next-intl";

import { Label } from "@louez/ui";
import type { CustomerFormBuiltInItem } from "@louez/validations";

import { CustomerBirthDateInput } from "@/components/dashboard/customers/customer-birth-date-input";
import { CustomerSourceInput } from "@/components/dashboard/customers/customer-source-input";
import { SocialLinksInput } from "@/components/dashboard/customers/social-links-input";
import { getFieldError } from "@/hooks/form/form-context";

import { CustomerFormAddress } from "./customer-form-address";
import type { CustomerFormApi } from "./use-customer-form";
import { getCompanyNumberLabelKey } from "./util.customer-form";

interface CustomerFormBuiltInFieldProps {
  form: CustomerFormApi;
  item: CustomerFormBuiltInItem;
}

/** One Louez field of the customer form, bound to the form. */
export const CustomerFormBuiltInField = ({ form, item }: CustomerFormBuiltInFieldProps) => {
  const t = useTranslations("dashboard.customers.form");
  const country = useStore(form.store, (state) => state.values.country);

  switch (item.key) {
    case "firstName":
      return (
        <form.AppField name="firstName">
          {(field) => (
            <field.Input
              label={t("firstName")}
              placeholder={t("firstNamePlaceholder")}
              autoComplete="off"
            />
          )}
        </form.AppField>
      );
    case "lastName":
      return (
        <form.AppField name="lastName">
          {(field) => (
            <field.Input
              label={t("lastName")}
              placeholder={t("lastNamePlaceholder")}
              autoComplete="off"
            />
          )}
        </form.AppField>
      );
    case "email":
      return (
        <form.AppField name="email">
          {(field) => (
            <field.Input
              type="email"
              label={t("email")}
              placeholder={t("emailPlaceholder")}
              autoComplete="off"
            />
          )}
        </form.AppField>
      );
    case "phone":
      return (
        <form.AppField name="phone">
          {(field) => <field.PhoneInput label={t("phone")} placeholder={t("phonePlaceholder")} />}
        </form.AppField>
      );
    case "address":
      return <CustomerFormAddress form={form} />;
    case "companyName":
      return (
        <form.AppField name="companyName">
          {(field) => (
            <field.Input
              label={`${t("companyName")} *`}
              placeholder={t("companyNamePlaceholder")}
            />
          )}
        </form.AppField>
      );
    case "companyNumber":
      return (
        <form.AppField name="companyNumber">
          {(field) => (
            <field.Input
              label={t(getCompanyNumberLabelKey(country))}
              placeholder={t("companyNumberPlaceholder")}
              description={t("companyNumberHelp")}
            />
          )}
        </form.AppField>
      );
    case "vatNumber":
      return (
        <form.AppField name="vatNumber">
          {(field) => (
            <field.Input label={t("vatNumber")} placeholder={t("vatNumberPlaceholder")} />
          )}
        </form.AppField>
      );
    case "birthDate":
      return (
        <form.Field name="birthDate">
          {(field) => (
            <CustomerBirthDateInput
              id="customer-birth-date"
              value={field.state.value}
              onChange={field.handleChange}
              onBlur={field.handleBlur}
              required={item.required}
              error={
                field.state.meta.errors[0] ? getFieldError(field.state.meta.errors[0]) : undefined
              }
            />
          )}
        </form.Field>
      );
    case "acquisitionSource":
      return (
        <form.Field name="acquisitionSource">
          {(sourceField) => (
            <form.Field name="acquisitionSourceDetail">
              {(detailField) => (
                <CustomerSourceInput
                  id="customer-source"
                  source={sourceField.state.value}
                  detail={detailField.state.value}
                  onSourceChange={sourceField.handleChange}
                  onDetailChange={detailField.handleChange}
                  required={item.required}
                  error={
                    sourceField.state.meta.errors[0]
                      ? getFieldError(sourceField.state.meta.errors[0])
                      : undefined
                  }
                />
              )}
            </form.Field>
          )}
        </form.Field>
      );
    case "socialLinks":
      return (
        <form.Field name="socialLinks">
          {(field) => (
            <div className="flex min-w-0 flex-col gap-2">
              <Label>{t("socialSection")}</Label>
              <SocialLinksInput value={field.state.value} onChange={field.handleChange} />
            </div>
          )}
        </form.Field>
      );
  }
};
