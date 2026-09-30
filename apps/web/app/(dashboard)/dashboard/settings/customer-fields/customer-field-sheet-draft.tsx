"use client";

import { useTranslations } from "next-intl";

import { Button, SheetFooter, SheetPanel } from "@louez/ui";

import { getFieldError } from "@/hooks/form/form-context";

import { CustomerFieldLayoutGroup } from "./customer-field-layout-group";
import { CustomerFieldSettingsBody } from "./customer-field-settings-body";
import { CustomerFieldSheetHeader } from "./customer-field-sheet-header";
import { CUSTOMER_FIELD_TYPE_ICONS } from "./customer-field-type-icon";
import { useCustomerFieldsBuilder } from "./customer-fields-builder-context";
import { DRAFT_FIELD_ID_PREFIX } from "./customer-fields.constants";
import { setDraftValues } from "./use-customer-field-form";

/**
 * The field being created: the same settings as a saved field, its name
 * focused, its row following each key. Nothing is saved until "Ajouter";
 * "Annuler", Escape or the backdrop drop it.
 */
export const CustomerFieldSheetDraft = () => {
  const t = useTranslations("dashboard.settings.customerFields.builder.inspector");
  const tTypes = useTranslations("dashboard.settings.customerFields.dialog.types");
  const { draftForm: form, closeSheet } = useCustomerFieldsBuilder();

  return (
    <form.AppForm>
      <form.Form className="flex h-full min-h-0 flex-col">
        <form.Subscribe
          selector={(state) => ({ label: state.values.label, type: state.values.type })}
        >
          {({ label, type }) => (
            <CustomerFieldSheetHeader
              title={label.trim() || t("newTitle")}
              kind={{ icon: CUSTOMER_FIELD_TYPE_ICONS[type], label: tTypes(type) }}
              onClose={closeSheet}
            />
          )}
        </form.Subscribe>
        <SheetPanel className="p-4 sm:p-5">
          <form.Subscribe
            selector={(state) => ({ values: state.values, fieldMeta: state.fieldMeta })}
          >
            {({ values, fieldMeta }) => (
              <CustomerFieldSettingsBody
                idPrefix={DRAFT_FIELD_ID_PREFIX}
                scope={values.scope}
                type={values.type}
                values={values}
                shown={null}
                textMode="live"
                autoFocusLabel
                layout={
                  <CustomerFieldLayoutGroup
                    width={values.width}
                    fixed={false}
                    onChange={(width) => form.setFieldValue("width", width)}
                  />
                }
                onChange={(_key, changes) => setDraftValues(form, changes)}
                errorFor={(key) => {
                  if (key === "online" || key === "isActive") return undefined;
                  const error = fieldMeta[key]?.errors[0];
                  return error ? getFieldError(error) : undefined;
                }}
              />
            )}
          </form.Subscribe>
        </SheetPanel>
        <SheetFooter>
          <Button type="button" variant="outline" onClick={closeSheet}>
            {t("cancel")}
          </Button>
          <form.SubscribeButton>{t("add")}</form.SubscribeButton>
        </SheetFooter>
      </form.Form>
    </form.AppForm>
  );
};
