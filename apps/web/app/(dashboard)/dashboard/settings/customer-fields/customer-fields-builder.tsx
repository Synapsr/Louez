"use client";

import { useTranslations } from "next-intl";

import { Skeleton, Tabs, TabsList, TabsPanel, TabsTab } from "@louez/ui";

import { CustomerFieldAddDialog } from "./customer-field-add-dialog";
import { CustomerFieldDeleteDialog } from "./customer-field-delete-dialog";
import { CustomerFieldSheet } from "./customer-field-sheet";
import { CustomerFieldTargetsDialog } from "./customer-field-targets-dialog";
import { CustomerFieldTemplatesDialog } from "./customer-field-templates-dialog";
import { useCustomerFieldsBuilder } from "./customer-fields-builder-context";
import { CustomerFieldsPreviewSheet } from "./customer-fields-preview-sheet";
import { CustomerFormCustomerPanel } from "./customer-form-customer-panel";
import { CustomerFormItemPanel } from "./customer-form-item-panel";

/**
 * Settings → Fiche client: two tabs, each one list of every field in the
 * order and width the forms use. A click opens a field's settings in a
 * Sheet; a drag moves it; its corner switches half and full row.
 */
export const CustomerFieldsBuilder = () => {
  const t = useTranslations("dashboard.settings.customerFields");
  const { isLoading, tab, setTab, fields, deletingId, closeDelete, targetsFollowUp, actions } =
    useCustomerFieldsBuilder();
  const deletingField = fields.find((field) => field.id === deletingId) ?? null;

  return (
    <>
      <Tabs
        value={tab}
        onValueChange={(value) => setTab(value === "item" ? "item" : "customer")}
        className="gap-3"
      >
        <TabsList variant="underline">
          <TabsTab value="customer">{t("title")}</TabsTab>
          <TabsTab value="item">{t("dialog.scopes.item")}</TabsTab>
        </TabsList>
        <TabsPanel value="customer">
          {isLoading ? (
            <Skeleton className="h-96 w-full rounded-2xl" />
          ) : (
            <CustomerFormCustomerPanel />
          )}
        </TabsPanel>
        <TabsPanel value="item">
          {isLoading ? <Skeleton className="h-48 w-full rounded-2xl" /> : <CustomerFormItemPanel />}
        </TabsPanel>
      </Tabs>

      <CustomerFieldSheet />
      <CustomerFieldsPreviewSheet />
      <CustomerFieldAddDialog />
      <CustomerFieldTemplatesDialog />
      {targetsFollowUp && (
        <CustomerFieldTargetsDialog
          key={targetsFollowUp.fieldIds.join()}
          followUp={targetsFollowUp}
        />
      )}
      <CustomerFieldDeleteDialog
        field={deletingField}
        isPending={actions.isRemoving}
        onOpenChange={(open) => !open && closeDelete()}
        onHide={(id) => {
          actions.hideField(id);
          closeDelete();
        }}
        onConfirm={(id) => actions.removeField(id, closeDelete)}
      />
    </>
  );
};
