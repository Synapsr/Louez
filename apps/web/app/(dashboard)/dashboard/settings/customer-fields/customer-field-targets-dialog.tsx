"use client";

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

import { CustomerFieldOnlineControls } from "./customer-field-online-controls";
import { type TargetsFollowUp, useCustomerFieldsBuilder } from "./customer-fields-builder-context";
import { useCustomerFieldTargetsForm } from "./use-customer-field-targets-form";
import { pickOnlineSettings } from "./util.customer-field-online";

interface CustomerFieldTargetsDialogProps {
  followUp: TargetsFollowUp;
}

/**
 * Right after a template added per-item fields: which products they concern
 * (none until picked) and whether the customer is asked. "Plus tard" leaves
 * them as they are. Mounted per adoption.
 */
export const CustomerFieldTargetsDialog = ({ followUp }: CustomerFieldTargetsDialogProps) => {
  const t = useTranslations("dashboard.settings.customerFields.sectionOnline");
  const { fields, closeTargetsFollowUp, actions } = useCustomerFieldsBuilder();
  // The fields a template adds share their settings: the first one's are everyone's.
  const first = fields.find((field) => followUp.fieldIds.includes(field.id));

  const form = useCustomerFieldTargetsForm({
    defaultValues: first
      ? pickOnlineSettings(first)
      : { collectMode: "never", targetMode: "products", targets: [], customerEditable: false },
    onSubmit: async (settings) => {
      if (await actions.applyOnlineSettings(followUp.fieldIds, settings)) closeTargetsFollowUp();
    },
  });

  return (
    <Dialog open onOpenChange={(open) => !open && closeTargetsFollowUp()}>
      <DialogPopup className="sm:max-w-xl">
        <form.AppForm>
          {/* A flex column, so a long form scrolls in its panel and the footer stays put. */}
          <form.Form className="flex min-h-0 flex-col">
            <DialogHeader>
              <DialogTitle>{t("adoptedTitle")}</DialogTitle>
              <DialogDescription>
                {t("adoptedDescription", { section: followUp.templateName })}
              </DialogDescription>
            </DialogHeader>
            <DialogPanel>
              <form.Subscribe selector={(state) => state.values}>
                {(values) => (
                  <CustomerFieldOnlineControls
                    idPrefix="targets-follow-up"
                    value={values}
                    carriesItems
                    targetsFirst
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
            <DialogFooter>
              <Button type="button" variant="outline" onClick={closeTargetsFollowUp}>
                {t("later")}
              </Button>
              <form.SubscribeButton>{t("apply")}</form.SubscribeButton>
            </DialogFooter>
          </form.Form>
        </form.AppForm>
      </DialogPopup>
    </Dialog>
  );
};
