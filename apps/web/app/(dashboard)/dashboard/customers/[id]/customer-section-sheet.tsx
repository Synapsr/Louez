"use client";

import { useStore } from "@tanstack/react-form";
import { useTranslations } from "next-intl";

import type {
  CustomerFieldDefinition,
  CustomerFieldValues,
  CustomerProfileSettings,
} from "@louez/types";
import {
  Button,
  Sheet,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetPanel,
  SheetPopup,
  SheetTitle,
} from "@louez/ui";

import { CustomerFieldControl } from "@/components/dashboard/customers/customer-field-control";
import { CustomerProfileFields } from "@/components/dashboard/customers/customer-profile-fields";
import { SocialLinksInput } from "@/components/dashboard/customers/social-links-input";
import { RootError } from "@/components/form/root-error";
import { getFieldError } from "@/hooks/form/form-context";

import type { CustomerRecord, CustomerRecordSection } from "./customer-record.types";
import { useCustomerSectionForm } from "./use-customer-section-form";

interface CustomerSectionSheetProps {
  customer: CustomerRecord;
  section: CustomerRecordSection;
  title: string;
  fields: CustomerFieldDefinition[];
  customFields: CustomerFieldValues;
  profileSettings: CustomerProfileSettings;
  onClose: () => void;
}

/** Mounted per opening (keyed by the caller): one card of the record, edited without leaving it. */
export const CustomerSectionSheet = ({
  customer,
  section,
  title,
  fields,
  customFields,
  profileSettings,
  onClose,
}: CustomerSectionSheetProps) => {
  const t = useTranslations("dashboard.customers");
  const { form, rootError, fieldIssues } = useCustomerSectionForm({
    customer,
    section,
    fieldIds: fields.map((field) => field.id),
    customFields,
    profileSettings,
    onSaved: onClose,
  });
  const values = useStore(form.store, (state) => state.values);
  const birthDateError = useStore(form.store, (state) => state.fieldMeta.birthDate?.errors?.[0]);
  const sourceError = useStore(
    form.store,
    (state) => state.fieldMeta.acquisitionSource?.errors?.[0],
  );

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetPopup>
        <form.AppForm>
          <form.Form className="flex h-full flex-col">
            <SheetHeader>
              <SheetTitle>{t("detail.editSection", { section: title })}</SheetTitle>
              <SheetDescription>{t("detail.editSectionDescription")}</SheetDescription>
            </SheetHeader>
            <SheetPanel className="flex-1 space-y-4">
              <RootError error={rootError} />

              {section.kind === "contact" && (
                <>
                  <form.AppField name="email">
                    {(field) => <field.Input type="email" label={t("email")} autoComplete="off" />}
                  </form.AppField>
                  <form.AppField name="phone">
                    {(field) => <field.PhoneInput label={t("phone")} />}
                  </form.AppField>
                  <form.AppField name="address">
                    {(field) => <field.Input label={t("address")} />}
                  </form.AppField>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <form.AppField name="postalCode">
                      {(field) => <field.Input label={t("postalCode")} />}
                    </form.AppField>
                    <form.AppField name="city">
                      {(field) => <field.Input label={t("city")} />}
                    </form.AppField>
                  </div>
                  <form.AppField name="country">
                    {(field) => (
                      <field.CountrySelect
                        label={t("country")}
                        placeholder={t("form.selectCountry")}
                      />
                    )}
                  </form.AppField>
                  {profileSettings.socialLinks !== "hidden" && (
                    <div className="space-y-2">
                      <p className="text-sm font-medium">{t("form.socialSection")}</p>
                      <SocialLinksInput
                        value={values.socialLinks}
                        onChange={(links) => form.setFieldValue("socialLinks", links)}
                      />
                    </div>
                  )}
                </>
              )}

              {section.kind === "profile" && (
                <CustomerProfileFields
                  value={{
                    birthDate: values.birthDate,
                    acquisitionSource: values.acquisitionSource,
                    acquisitionSourceDetail: values.acquisitionSourceDetail,
                  }}
                  settings={profileSettings}
                  errors={{
                    birthDate: birthDateError ? getFieldError(birthDateError) : undefined,
                    acquisitionSource: sourceError ? getFieldError(sourceError) : undefined,
                  }}
                  onChange={(changes) => {
                    if (changes.birthDate !== undefined) {
                      form.setFieldValue("birthDate", changes.birthDate);
                    }
                    if (changes.acquisitionSource !== undefined) {
                      form.setFieldValue("acquisitionSource", changes.acquisitionSource);
                    }
                    if (changes.acquisitionSourceDetail !== undefined) {
                      form.setFieldValue(
                        "acquisitionSourceDetail",
                        changes.acquisitionSourceDetail,
                      );
                    }
                  }}
                />
              )}

              {section.kind === "custom" &&
                fields.map((definition) => (
                  <CustomerFieldControl
                    key={definition.id}
                    definition={definition}
                    customerId={customer.id}
                    value={values.customFields[definition.id] ?? ""}
                    error={
                      fieldIssues[definition.id]
                        ? t(`fields.issues.${fieldIssues[definition.id]}`)
                        : undefined
                    }
                    onChange={(value) =>
                      form.setFieldValue("customFields", {
                        ...values.customFields,
                        [definition.id]: value,
                      })
                    }
                  />
                ))}
            </SheetPanel>
            <SheetFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                {t("detail.cancel")}
              </Button>
              <form.SubscribeButton>{t("detail.save")}</form.SubscribeButton>
            </SheetFooter>
          </form.Form>
        </form.AppForm>
      </SheetPopup>
    </Sheet>
  );
};
