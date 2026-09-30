"use client";

import { useTranslations } from "next-intl";

import type { CustomerFieldDefinition } from "@louez/types";
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
  useControlsDisabled,
} from "@louez/ui";

import { InfoCallout } from "@/components/dashboard/info-callout";

import { CustomerFieldOnlineControls } from "./customer-field-online-controls";
import { useCustomerFieldSectionOnlineForm } from "./use-customer-field-section-online-form";
import {
  type CustomerFieldOnlineSettings,
  commonOnlineSettings,
} from "./util.customer-field-online";

interface CustomerFieldSectionOnlineDialogProps {
  section: string;
  /** The active fields of the section, in order. */
  fields: CustomerFieldDefinition[];
  /**
   * `adopted`: opened right after a template brought per-unit fields, to pick
   * the products they concern ("Pour quels produits ?").
   */
  reason: "menu" | "adopted";
  onOpenChange: (open: boolean) => void;
  onSubmit: (settings: CustomerFieldOnlineSettings) => Promise<void>;
}

/** "Réservation en ligne…" of a section: one change for every field in it. Mounted per opening. */
export const CustomerFieldSectionOnlineDialog = ({
  section,
  fields,
  reason,
  onOpenChange,
  onSubmit,
}: CustomerFieldSectionOnlineDialogProps) => {
  const t = useTranslations("dashboard.settings.customerFields.sectionOnline");
  const readOnly = useControlsDisabled();
  const { settings, mixed } = commonOnlineSettings(fields);
  const carriesItems = fields.some((field) => field.scope === "item");

  const form = useCustomerFieldSectionOnlineForm({ defaultValues: settings, onSubmit });

  return (
    <Dialog open onOpenChange={onOpenChange}>
      {/* Read-only members keep the close button; the controls stay disabled below. */}
      <DisabledControlsProvider disabled={false}>
        <DialogPopup className="sm:max-w-lg">
          <form.AppForm>
            {/* A flex column, so a long form scrolls in its panel and the footer stays put. */}
            <form.Form className="flex min-h-0 flex-col">
              <DialogHeader>
                <DialogTitle>{reason === "adopted" ? t("adoptedTitle") : t("title")}</DialogTitle>
                <DialogDescription>
                  {reason === "adopted"
                    ? t("adoptedDescription", { section })
                    : t("description", { section, count: fields.length })}
                </DialogDescription>
              </DialogHeader>
              <DisabledControlsProvider disabled={readOnly}>
                <DialogPanel className="space-y-5">
                  {mixed && <InfoCallout>{t("mixed")}</InfoCallout>}
                  <form.Subscribe selector={(state) => state.values}>
                    {(values) => (
                      <CustomerFieldOnlineControls
                        idPrefix="section-online"
                        value={values}
                        carriesItems={carriesItems}
                        targetsFirst={reason === "adopted"}
                        onChange={(next) => {
                          form.setFieldValue("collectMode", next.collectMode);
                          form.setFieldValue("targetMode", next.targetMode);
                          form.setFieldValue("targets", next.targets);
                          form.setFieldValue("customerEditable", next.customerEditable);
                        }}
                      />
                    )}
                  </form.Subscribe>
                </DialogPanel>
              </DisabledControlsProvider>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                  {readOnly ? t("close") : reason === "adopted" ? t("later") : t("cancel")}
                </Button>
                {!readOnly && <form.SubscribeButton>{t("apply")}</form.SubscribeButton>}
              </DialogFooter>
            </form.Form>
          </form.AppForm>
        </DialogPopup>
      </DisabledControlsProvider>
    </Dialog>
  );
};
