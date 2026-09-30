"use client";

import { useRouter } from "next/navigation";

import { useTranslations } from "next-intl";

import type { CustomerFieldValues } from "@louez/types";
import {
  Button,
  Sheet,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetPanel,
  SheetPopup,
  SheetTitle,
  toastManager,
} from "@louez/ui";
import type { CustomerFormLayoutItem } from "@louez/validations";

import { RootError } from "@/components/form/root-error";

import { CustomerFormFields } from "../customer-form-fields";
import { useCustomerForm } from "../use-customer-form";
import type { CustomerRecord } from "./customer-record.types";

interface CustomerRecordSheetProps {
  customer: CustomerRecord;
  /** What the record's card lists, in layout order: the Sheet edits exactly that. */
  items: CustomerFormLayoutItem[];
  customFields: CustomerFieldValues;
  onClose: () => void;
}

/** Mounted per opening: the record's "Informations", edited without leaving it. */
export const CustomerRecordSheet = ({
  customer,
  items,
  customFields,
  onClose,
}: CustomerRecordSheetProps) => {
  const t = useTranslations("dashboard.customers.detail");
  const router = useRouter();
  const { form, rootError, fieldIssues } = useCustomerForm({
    customer,
    initialCustomFields: customFields,
    items,
    save: { kind: "record", customerId: customer.id },
    onSaved: () => {
      toastManager.add({ title: t("sectionSaved"), type: "success" });
      router.refresh();
      onClose();
    },
  });

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetPopup className="sm:max-w-xl">
        <form.AppForm>
          <form.Form className="flex h-full min-h-0 flex-col">
            <SheetHeader>
              <SheetTitle>{t("editSection", { section: t("infoCard") })}</SheetTitle>
              <SheetDescription>{t("editSectionDescription")}</SheetDescription>
            </SheetHeader>
            <SheetPanel className="flex-1 space-y-4">
              <RootError error={rootError} />
              <CustomerFormFields
                form={form}
                items={items}
                fieldIssues={fieldIssues}
                customerId={customer.id}
              />
            </SheetPanel>
            <SheetFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                {t("cancel")}
              </Button>
              <form.SubscribeButton>{t("save")}</form.SubscribeButton>
            </SheetFooter>
          </form.Form>
        </form.AppForm>
      </SheetPopup>
    </Sheet>
  );
};
