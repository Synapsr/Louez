"use client";

import { useTranslations } from "next-intl";

import { CUSTOMER_FIELD_TYPES, type CustomerFieldDefinition } from "@louez/types";
import {
  Button,
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
  Label,
  SelectItem,
} from "@louez/ui";

import { FormRadioCardGroup } from "@/components/form/form-radio-card-group";
import { PanelSegmentedControl } from "@/components/online-store/panel/panel-segmented-control";
import { PanelSwitchRow } from "@/components/online-store/panel/panel-switch-row";
import { getFieldError } from "@/hooks/form/form-context";

import { CustomerFieldOptionsInput } from "./customer-field-options-input";
import { CUSTOMER_FIELD_TYPE_ICONS } from "./customer-field-type-icon";
import { type CustomerFieldFormValues, useCustomerFieldForm } from "./use-customer-field-form";

interface CustomerFieldDialogProps {
  field: CustomerFieldDefinition | null;
  defaultSection: string;
  sections: string[];
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: CustomerFieldFormValues) => Promise<void>;
}

const FLAGS = [
  { name: "isRequired", key: "required" },
  { name: "isSensitive", key: "sensitive" },
  { name: "showOnContract", key: "contract" },
  { name: "isSearchable", key: "search" },
  { name: "showInList", key: "list" },
] as const;

/** Mounted per opening (keyed by the caller), so its form always starts from the right field. */
export const CustomerFieldDialog = ({
  field,
  defaultSection,
  sections,
  onOpenChange,
  onSubmit,
}: CustomerFieldDialogProps) => {
  const t = useTranslations("dashboard.settings.customerFields.dialog");
  const tValidation = useTranslations("validation");
  const tErrors = useTranslations("errors");
  const isEditing = field !== null;

  const form = useCustomerFieldForm({
    field,
    defaultSection,
    messages: { required: tValidation("required"), optionsRequired: tErrors("optionsRequired") },
    onSubmit,
  });

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogPopup className="sm:max-w-xl">
        <form.AppForm>
          <form.Form>
            <DialogHeader>
              <DialogTitle>{isEditing ? t("editTitle") : t("createTitle")}</DialogTitle>
              <DialogDescription>
                {isEditing ? t("editDescription") : t("createDescription")}
              </DialogDescription>
            </DialogHeader>
            <DialogPanel className="space-y-5">
              <form.AppField name="label">
                {(control) => (
                  <control.Input label={t("label")} placeholder={t("labelPlaceholder")} autoFocus />
                )}
              </form.AppField>

              <form.Field name="type">
                {(control) => (
                  <div className="space-y-2">
                    <FormRadioCardGroup
                      label={t("type")}
                      columns={3}
                      value={control.state.value}
                      onChange={(type) => !isEditing && control.handleChange(type)}
                      options={CUSTOMER_FIELD_TYPES.map((type) => ({
                        value: type,
                        label: t(`types.${type}`),
                        icon: CUSTOMER_FIELD_TYPE_ICONS[type],
                      }))}
                      className={isEditing ? "pointer-events-none opacity-60" : undefined}
                    />
                    {isEditing && (
                      <p className="text-muted-foreground text-sm">{t("typeLocked")}</p>
                    )}
                  </div>
                )}
              </form.Field>

              <form.Subscribe selector={(state) => state.values.type}>
                {(type) => (
                  <>
                    {type === "select" && (
                      <form.Field name="options">
                        {(control) => (
                          <div className="space-y-2">
                            <Label htmlFor="field-options">{t("options")}</Label>
                            <CustomerFieldOptionsInput
                              id="field-options"
                              value={control.state.value}
                              placeholder={t("optionsPlaceholder")}
                              invalid={control.state.meta.errors.length > 0}
                              onChange={control.handleChange}
                            />
                            {control.state.meta.errors[0] && (
                              <p className="text-destructive text-sm">
                                {getFieldError(control.state.meta.errors[0])}
                              </p>
                            )}
                          </div>
                        )}
                      </form.Field>
                    )}
                    {type === "number" && (
                      <form.AppField name="unit">
                        {(control) => (
                          <control.Input label={t("unit")} placeholder={t("unitPlaceholder")} />
                        )}
                      </form.AppField>
                    )}
                  </>
                )}
              </form.Subscribe>

              <div className="grid gap-4 sm:grid-cols-2">
                <form.AppField name="section">
                  {(control) =>
                    sections.length > 0 ? (
                      <control.Select
                        label={t("section")}
                        items={sections.map((section) => ({ value: section, label: section }))}
                      >
                        {sections.map((section) => (
                          <SelectItem key={section} value={section} label={section}>
                            {section}
                          </SelectItem>
                        ))}
                      </control.Select>
                    ) : (
                      <control.Input label={t("section")} />
                    )
                  }
                </form.AppField>
                <form.Field name="appliesTo">
                  {(control) => (
                    <div className="space-y-2">
                      <Label>{t("appliesTo")}</Label>
                      <PanelSegmentedControl
                        aria-label={t("appliesTo")}
                        value={control.state.value}
                        onChange={control.handleChange}
                        options={[
                          { value: "all", label: t("appliesToAll") },
                          { value: "individual", label: t("appliesToIndividual") },
                          { value: "business", label: t("appliesToBusiness") },
                        ]}
                      />
                    </div>
                  )}
                </form.Field>
              </div>

              <form.AppField name="helpText">
                {(control) => (
                  <control.Input label={t("helpText")} placeholder={t("helpTextPlaceholder")} />
                )}
              </form.AppField>

              <div className="divide-y rounded-lg border px-3">
                {FLAGS.map(({ name, key }) => (
                  <form.Field key={name} name={name}>
                    {(control) => (
                      <div className="py-2.5">
                        <PanelSwitchRow
                          id={`field-flag-${key}`}
                          label={t(`flags.${key}`)}
                          hint={t(`flags.${key}Help`)}
                          checked={control.state.value}
                          onCheckedChange={control.handleChange}
                        />
                      </div>
                    )}
                  </form.Field>
                ))}
              </div>
            </DialogPanel>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                {t("cancel")}
              </Button>
              <form.SubscribeButton>{isEditing ? t("save") : t("create")}</form.SubscribeButton>
            </DialogFooter>
          </form.Form>
        </form.AppForm>
      </DialogPopup>
    </Dialog>
  );
};
