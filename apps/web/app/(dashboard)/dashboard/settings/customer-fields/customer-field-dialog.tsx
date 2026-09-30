"use client";

import { Globe, Package, UserRound } from "lucide-react";
import { useTranslations } from "next-intl";

import {
  CUSTOMER_FIELD_SCOPES,
  CUSTOMER_FIELD_TYPES,
  type CustomerFieldDefinition,
} from "@louez/types";
import {
  Button,
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
  DisabledControlsProvider,
  Label,
  SelectItem,
  useControlsDisabled,
} from "@louez/ui";
import { cn } from "@louez/utils";

import { DashboardIconTile } from "@/components/dashboard/shared/dashboard-icon-tile";
import { FormRadioCardGroup } from "@/components/form/form-radio-card-group";
import { PanelSegmentedControl } from "@/components/online-store/panel/panel-segmented-control";
import { PanelSwitchRow } from "@/components/online-store/panel/panel-switch-row";
import { getFieldError } from "@/hooks/form/form-context";

import { CustomerFieldOnlineControls } from "./customer-field-online-controls";
import { CustomerFieldOptionsInput } from "./customer-field-options-input";
import { CUSTOMER_FIELD_TYPE_ICONS } from "./customer-field-type-icon";
import { type CustomerFieldFormValues, useCustomerFieldForm } from "./use-customer-field-form";
import type { CustomerFieldOnlineSettings } from "./util.customer-field-online";

interface CustomerFieldDialogProps {
  field: CustomerFieldDefinition | null;
  defaultSection: string;
  /** Scope and online settings a new field starts from (those of its section). */
  defaults: Pick<CustomerFieldFormValues, "scope"> & CustomerFieldOnlineSettings;
  sections: string[];
  onOpenChange: (open: boolean) => void;
  onSubmit: (values: CustomerFieldFormValues) => Promise<void>;
}

const SCOPE_ICONS = { customer: UserRound, item: Package } as const;

/** Switches of the customer record; an item field has no record to be required, searched or listed on. */
const FLAGS = [
  { name: "isRequired", key: "requiredTeam", helpKey: "requiredHelp", customerOnly: true },
  { name: "isSensitive", key: "sensitive", helpKey: "sensitiveHelp", customerOnly: false },
  { name: "showOnContract", key: "contract", helpKey: "contractHelp", customerOnly: false },
  { name: "isSearchable", key: "search", helpKey: "searchHelp", customerOnly: true },
  { name: "showInList", key: "list", helpKey: "listHelp", customerOnly: true },
] as const;

/** Help lines that read differently once the value lives on a rented unit. */
const ITEM_HELP_KEYS: Partial<Record<(typeof FLAGS)[number]["helpKey"], string>> = {
  sensitiveHelp: "sensitiveItemHelp",
  contractHelp: "contractItemHelp",
};

/**
 * Mounted per opening (keyed by the caller), so its form always starts from
 * the right field. Collaborators without `manage_settings` read it with every
 * control disabled, and can still close it.
 */
export const CustomerFieldDialog = ({
  field,
  defaultSection,
  defaults,
  sections,
  onOpenChange,
  onSubmit,
}: CustomerFieldDialogProps) => {
  const t = useTranslations("dashboard.settings.customerFields.dialog");
  const tValidation = useTranslations("validation");
  const tErrors = useTranslations("errors");
  const readOnly = useControlsDisabled();
  const isEditing = field !== null;

  const form = useCustomerFieldForm({
    field,
    defaultSection,
    defaults,
    messages: { required: tValidation("required"), optionsRequired: tErrors("optionsRequired") },
    onSubmit,
  });

  return (
    <Dialog open onOpenChange={onOpenChange}>
      {/* The settings page disables every control for read-only members, the
          dialog's close button included: give it back, then disable the fields. */}
      <DisabledControlsProvider disabled={false}>
        <DialogPopup className="sm:max-w-xl">
          <form.AppForm>
            {/* A flex column, so a long form scrolls in its panel and the footer stays put. */}
            <form.Form className="flex min-h-0 flex-col">
              <form.Subscribe selector={(state) => state.values.scope}>
                {(scope) => (
                  <DialogHeader>
                    <DialogTitle>{isEditing ? t("editTitle") : t("createTitle")}</DialogTitle>
                    <DialogDescription>
                      {isEditing
                        ? t("editDescription")
                        : t(scope === "item" ? "createDescriptionItem" : "createDescription")}
                    </DialogDescription>
                  </DialogHeader>
                )}
              </form.Subscribe>
              <DisabledControlsProvider disabled={readOnly}>
                <DialogPanel className="space-y-5">
                  <form.Subscribe selector={(state) => state.values.scope}>
                    {(scope) => (
                      <form.AppField name="label">
                        {(control) => (
                          <control.Input
                            label={t("label")}
                            placeholder={t(
                              scope === "item" ? "labelPlaceholderItem" : "labelPlaceholder",
                            )}
                            autoFocus={!isEditing}
                          />
                        )}
                      </form.AppField>
                    )}
                  </form.Subscribe>

                  <form.Field name="scope">
                    {(control) => (
                      <div className="space-y-2">
                        <FormRadioCardGroup
                          label={t("scope")}
                          columns={2}
                          value={control.state.value}
                          onChange={(scope) => !isEditing && control.handleChange(scope)}
                          options={CUSTOMER_FIELD_SCOPES.map((scope) => ({
                            value: scope,
                            label: t(`scopes.${scope}`),
                            description: t(`scopes.${scope}Description`),
                            icon: SCOPE_ICONS[scope],
                          }))}
                          className={cn(
                            "max-sm:grid-cols-1",
                            isEditing && "pointer-events-none opacity-60",
                          )}
                        />
                        {isEditing && (
                          <p className="text-muted-foreground text-sm">{t("scopeLocked")}</p>
                        )}
                      </div>
                    )}
                  </form.Field>

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
                          // Three cards per row do not fit a phone: "Téléphone" overflows.
                          className={cn(
                            "max-sm:grid-cols-2",
                            isEditing && "pointer-events-none opacity-60",
                          )}
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

                  <form.Subscribe selector={(state) => state.values.scope}>
                    {(scope) => (
                      <>
                        {/* Stacked: "S'applique à" truncates its three segments in half a dialog. */}
                        <div className="space-y-5">
                          <form.AppField name="section">
                            {(control) =>
                              sections.length > 0 ? (
                                <control.Select
                                  label={t("section")}
                                  items={sections.map((section) => ({
                                    value: section,
                                    label: section,
                                  }))}
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
                          {scope === "customer" && (
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
                          )}
                        </div>

                        <form.AppField name="helpText">
                          {(control) => (
                            <control.Input
                              label={t("helpText")}
                              placeholder={t("helpTextPlaceholder")}
                            />
                          )}
                        </form.AppField>

                        <div className="divide-y rounded-lg border px-3">
                          {FLAGS.filter((flag) => scope === "customer" || !flag.customerOnly).map(
                            ({ name, key, helpKey }) => (
                              <form.Field key={name} name={name}>
                                {(control) => (
                                  <div className="py-2.5">
                                    <PanelSwitchRow
                                      id={`field-flag-${key}`}
                                      label={t(`flags.${key}`)}
                                      hint={t(
                                        `flags.${(scope === "item" && ITEM_HELP_KEYS[helpKey]) || helpKey}`,
                                      )}
                                      checked={control.state.value}
                                      onCheckedChange={control.handleChange}
                                    />
                                  </div>
                                )}
                              </form.Field>
                            ),
                          )}
                        </div>
                      </>
                    )}
                  </form.Subscribe>

                  <section
                    aria-labelledby="field-online-title"
                    className="space-y-5 rounded-lg border p-3 sm:p-4"
                  >
                    <div className="flex items-start gap-3">
                      <DashboardIconTile icon={Globe} accent="primary" size="sm" />
                      <div className="min-w-0">
                        <h3 id="field-online-title" className="text-sm font-semibold">
                          {t("online.title")}
                        </h3>
                        <p className="text-muted-foreground text-xs">{t("online.description")}</p>
                      </div>
                    </div>
                    <form.Subscribe
                      selector={(state) => ({
                        scope: state.values.scope,
                        settings: {
                          collectMode: state.values.collectMode,
                          targetMode: state.values.targetMode,
                          targets: state.values.targets,
                          customerEditable: state.values.customerEditable,
                        },
                      })}
                    >
                      {({ scope, settings }) => (
                        <CustomerFieldOnlineControls
                          idPrefix="field-online"
                          value={settings}
                          carriesItems={scope === "item"}
                          onChange={(next) => {
                            form.setFieldValue("collectMode", next.collectMode);
                            form.setFieldValue("targetMode", next.targetMode);
                            form.setFieldValue("targets", next.targets);
                            form.setFieldValue("customerEditable", next.customerEditable);
                          }}
                        />
                      )}
                    </form.Subscribe>
                  </section>
                </DialogPanel>
              </DisabledControlsProvider>
              <DialogFooter>
                {readOnly ? (
                  <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                    {t("close")}
                  </Button>
                ) : (
                  <>
                    <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                      {t("cancel")}
                    </Button>
                    <form.SubscribeButton>
                      {isEditing ? t("save") : t("create")}
                    </form.SubscribeButton>
                  </>
                )}
              </DialogFooter>
            </form.Form>
          </form.AppForm>
        </DialogPopup>
      </DisabledControlsProvider>
    </Dialog>
  );
};
