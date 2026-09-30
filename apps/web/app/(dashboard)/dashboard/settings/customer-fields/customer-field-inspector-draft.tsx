"use client";

import { useTranslations } from "next-intl";

import { Button } from "@louez/ui";

import { getFieldError } from "@/hooks/form/form-context";

import { CustomerFieldInspectorHeader } from "./customer-field-inspector-header";
import { CustomerFieldSettingsBody } from "./customer-field-settings-body";
import { useCustomerFieldsBuilder } from "./customer-fields-builder-context";
import { DRAFT_FIELD_ID_PREFIX } from "./customer-fields.constants";
import { setDraftValues } from "./use-customer-field-form";

/**
 * The field being created: the same settings as a saved field, the label
 * focused, the canvas following each key. Nothing is saved until "Ajouter";
 * "Annuler" or Escape drops it.
 */
export const CustomerFieldInspectorDraft = () => {
  const t = useTranslations("dashboard.settings.customerFields.builder.inspector");
  const tTypes = useTranslations("dashboard.settings.customerFields.dialog.types");
  const { draftForm: form, cancelDraft } = useCustomerFieldsBuilder();

  return (
    <form.AppForm>
      <form.Form className="flex min-h-0 flex-1 flex-col">
        <form.Subscribe
          selector={(state) => ({
            label: state.values.label,
            type: state.values.type,
            scope: state.values.scope,
          })}
        >
          {({ label, type, scope }) => (
            <CustomerFieldInspectorHeader
              title={label.trim() || t("newTitle")}
              type={type}
              typeLabel={tTypes(type)}
              scope={scope}
              onClose={cancelDraft}
            />
          )}
        </form.Subscribe>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 sm:p-5">
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
                onChange={(_key, changes) => setDraftValues(form, changes)}
                errorFor={(key) => {
                  if (key === "online" || key === "isActive") return undefined;
                  const error = fieldMeta[key]?.errors[0];
                  return error ? getFieldError(error) : undefined;
                }}
              />
            )}
          </form.Subscribe>
        </div>
        <div className="flex justify-end gap-2 border-t p-4">
          <Button type="button" variant="outline" onClick={cancelDraft}>
            {t("cancel")}
          </Button>
          <form.SubscribeButton>{t("add")}</form.SubscribeButton>
        </div>
      </form.Form>
    </form.AppForm>
  );
};
