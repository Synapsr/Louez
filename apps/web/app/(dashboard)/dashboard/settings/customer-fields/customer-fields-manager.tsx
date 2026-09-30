"use client";

import { useState } from "react";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { LayoutTemplate, Plus } from "lucide-react";
import { useTranslations } from "next-intl";

import type { CustomerFieldDefinition, CustomerProfileSettings } from "@louez/types";
import {
  Button,
  Collapsible,
  CollapsiblePanel,
  CollapsibleTrigger,
  Skeleton,
  toastManager,
  useControlsDisabled,
} from "@louez/ui";
import { CUSTOMER_FIELD_LIMITS } from "@louez/validations";

import { EmptyState } from "@/components/ui/empty-state";
import {
  type ResolvedCustomerFieldTemplate,
  resolveCustomerFieldTemplates,
  suggestCustomerFieldTemplates,
} from "@/lib/customers/customer-field-templates";
import {
  groupFieldsBySection,
  moveFieldToSection,
  moveItem,
  toReorderPayload,
} from "@/lib/customers/util.customer-fields";
import { orpc } from "@/lib/orpc/react";
import { getErrorMessageKey } from "@/lib/utils/util.error-message";
import type { StoreThemeInput } from "@/lib/theme/util.store-theme";

import { CustomerFieldDeleteDialog } from "./customer-field-delete-dialog";
import { CustomerFieldDialog } from "./customer-field-dialog";
import { CustomerFieldRow } from "./customer-field-row";
import { CustomerFieldSectionCard } from "./customer-field-section-card";
import { CustomerFieldSectionOnlineDialog } from "./customer-field-section-online-dialog";
import { CustomerFieldTemplatesDialog } from "./customer-field-templates-dialog";
import { CustomerFieldsPreview } from "./customer-fields-preview";
import { CustomerFieldsSuggestions } from "./customer-fields-suggestions";
import { CustomerNativeFieldsCard } from "./customer-native-fields-card";
import type { CustomerFieldFormValues } from "./use-customer-field-form";
import {
  type CustomerFieldOnlineSettings,
  newFieldDefaults,
  toCustomerFieldPayload,
} from "./util.customer-field-online";

interface CustomerFieldsManagerProps {
  country: string | null;
  productCategory: string | null;
  profileSettings: CustomerProfileSettings;
  /** The storefront look, so the "Client" preview reads like the real checkout. */
  storeTheme: StoreThemeInput | null;
}

type DialogState = { field: CustomerFieldDefinition | null; section: string } | null;

type SectionOnlineState = { section: string; reason: "menu" | "adopted" } | null;

export const CustomerFieldsManager = ({
  country,
  productCategory,
  profileSettings,
  storeTheme,
}: CustomerFieldsManagerProps) => {
  const t = useTranslations("dashboard.settings.customerFields");
  const tErrors = useTranslations("errors");
  const queryClient = useQueryClient();
  // Read-only for members without manage_settings: dragging would only earn a refusal.
  const readOnly = useControlsDisabled();

  const [dialog, setDialog] = useState<DialogState>(null);
  const [sectionOnline, setSectionOnline] = useState<SectionOnlineState>(null);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  const listOptions = orpc.dashboard.customerFields.list.queryOptions();
  const { data: fields, isPending: isLoading } = useQuery(listOptions);

  const mutationHandlers = (successKey: string | null) => ({
    onSuccess: (next: NonNullable<typeof fields>) => {
      queryClient.setQueryData(listOptions.queryKey, next);
      if (successKey) toastManager.add({ title: t(successKey), type: "success" });
    },
    onError: (error: unknown) => {
      const key = getErrorMessageKey(error);
      toastManager.add({
        title: tErrors.has(key) ? tErrors(key) : tErrors("generic"),
        type: "error",
      });
    },
  });

  const createField = useMutation(
    orpc.dashboard.customerFields.create.mutationOptions(mutationHandlers("toasts.created")),
  );
  const updateField = useMutation(
    orpc.dashboard.customerFields.update.mutationOptions(mutationHandlers(null)),
  );
  const updateSectionOnline = useMutation(
    orpc.dashboard.customerFields.updateSectionOnline.mutationOptions(
      mutationHandlers("toasts.sectionOnlineSaved"),
    ),
  );
  const reorderFields = useMutation(
    orpc.dashboard.customerFields.reorder.mutationOptions(mutationHandlers(null)),
  );
  const renameSection = useMutation(
    orpc.dashboard.customerFields.renameSection.mutationOptions(
      mutationHandlers("toasts.sectionRenamed"),
    ),
  );
  const removeField = useMutation(
    orpc.dashboard.customerFields.remove.mutationOptions(mutationHandlers("toasts.deleted")),
  );
  const adoptTemplate = useMutation(
    orpc.dashboard.customerFields.adoptTemplate.mutationOptions(mutationHandlers(null)),
  );

  if (isLoading || !fields) return <Skeleton className="h-64 w-full" />;

  const active = fields.filter((field) => field.isActive);
  const archived = fields.filter((field) => !field.isActive);
  const sections = groupFieldsBySection(active);
  const sectionNames = sections.map((section) => section.name);
  const fieldsOfSection = (name: string) =>
    sections.find((section) => section.name === name)?.fields ?? [];
  const adoptedKeys = new Set(fields.map((field) => field.key));
  const templates = resolveCustomerFieldTemplates((key) => t(`templates.${key}`));
  const suggestions = suggestCustomerFieldTemplates({
    templates,
    country,
    productCategory,
    adoptedKeys,
  });
  const isBusy = reorderFields.isPending || updateField.isPending || readOnly;

  const handleAdopt = (template: ResolvedCustomerFieldTemplate) =>
    adoptTemplate.mutate(
      { templateKey: template.id, fields: template.fields },
      {
        onSuccess: (next) => {
          const added = next.length - fields.length;
          if (added <= 0) return;
          toastManager.add({
            title: t("templates.adoptedToast", { count: added }),
            type: "success",
          });
          // Per-unit fields concern no product until the owner picks them: ask right away.
          const section = template.fields[0]?.section;
          if (template.scope === "item" && section) {
            setGalleryOpen(false);
            setSectionOnline({ section, reason: "adopted" });
          }
        },
      },
    );

  const handleSubmit = async (values: CustomerFieldFormValues) => {
    const editing = dialog?.field;
    const payload = toCustomerFieldPayload(values);
    if (editing) {
      const { type: _type, scope: _scope, ...changes } = payload;
      await updateField.mutateAsync({ id: editing.id, ...changes });
      toastManager.add({ title: t("toasts.updated"), type: "success" });
    } else {
      await createField.mutateAsync(payload);
    }
    setDialog(null);
  };

  const handleSectionOnline = async (settings: CustomerFieldOnlineSettings) => {
    if (!sectionOnline) return;
    await updateSectionOnline.mutateAsync({ section: sectionOnline.section, ...settings });
    setSectionOnline(null);
  };

  const setActive = (field: CustomerFieldDefinition, isActive: boolean) =>
    updateField.mutate(
      { id: field.id, isActive },
      {
        onSuccess: () =>
          toastManager.add({
            title: t(isActive ? "toasts.restored" : "toasts.archived"),
            type: "success",
          }),
      },
    );

  const rowActions = {
    onEdit: (field: CustomerFieldDefinition) => setDialog({ field, section: field.section }),
    onSetActive: setActive,
    onMove: (field: CustomerFieldDefinition, section: string) =>
      reorderFields.mutate({
        fields: toReorderPayload(moveFieldToSection(sections, field.id, section)),
      }),
    onDelete: (field: CustomerFieldDefinition) => setDeleting(field.id),
  };

  const deletingField = fields.find((field) => field.id === deleting) ?? null;

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-muted-foreground text-sm">
          {t("limits", { count: active.length, max: CUSTOMER_FIELD_LIMITS.activeFields })}
        </p>
        <div className="flex gap-2">
          <Button type="button" variant="outline" onClick={() => setGalleryOpen(true)}>
            <LayoutTemplate className="size-4" />
            {t("suggestions.browse")}
          </Button>
          <Button
            type="button"
            onClick={() =>
              setDialog({ field: null, section: sectionNames[0] ?? t("sections.defaultName") })
            }
          >
            <Plus className="size-4" />
            {t("field.add")}
          </Button>
        </div>
      </div>

      {suggestions.length > 0 && (
        <CustomerFieldsSuggestions
          templates={suggestions}
          isPending={adoptTemplate.isPending}
          onAdopt={handleAdopt}
          onBrowse={() => setGalleryOpen(true)}
        />
      )}

      <div className="grid gap-4 sm:gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-4 sm:space-y-6">
          <CustomerNativeFieldsCard settings={profileSettings} />

          {sections.length === 0 && (
            <EmptyState
              icon={LayoutTemplate}
              title={t("empty.title")}
              description={t("empty.description")}
            />
          )}

          {sections.map((section, index) => (
            <CustomerFieldSectionCard
              key={section.name}
              name={section.name}
              fields={section.fields}
              otherSections={sectionNames.filter((name) => name !== section.name)}
              isFirst={index === 0}
              isLast={index === sections.length - 1}
              disabled={isBusy}
              onAddField={(name) => setDialog({ field: null, section: name })}
              onReorder={(name, reordered) =>
                reorderFields.mutate({
                  fields: toReorderPayload(
                    sections.map((entry) =>
                      entry.name === name ? { ...entry, fields: reordered } : entry,
                    ),
                  ),
                })
              }
              onRename={(from, to) => renameSection.mutate({ from, to })}
              onMoveSection={(name, direction) => {
                const from = sectionNames.indexOf(name);
                reorderFields.mutate({
                  fields: toReorderPayload(moveItem(sections, from, from + direction)),
                });
              }}
              onOnlineSettings={(name) => setSectionOnline({ section: name, reason: "menu" })}
              {...rowActions}
            />
          ))}

          {archived.length > 0 && (
            <Collapsible>
              <CollapsibleTrigger render={<Button type="button" variant="ghost" size="sm" />}>
                {t("archived.title")} ({archived.length})
              </CollapsibleTrigger>
              <CollapsiblePanel>
                <p className="text-muted-foreground px-1 py-2 text-sm">
                  {t("archived.description")}
                </p>
                <ul className="space-y-2">
                  {archived.map((field, index) => (
                    <CustomerFieldRow
                      key={field.id}
                      field={field}
                      index={index}
                      group="archived"
                      otherSections={[]}
                      disabled
                      {...rowActions}
                    />
                  ))}
                </ul>
              </CollapsiblePanel>
            </Collapsible>
          )}
        </div>

        <aside className="hidden min-w-0 xl:block">
          <div className="sticky top-16">
            <CustomerFieldsPreview sections={sections} theme={storeTheme} />
          </div>
        </aside>
      </div>

      {dialog && (
        <CustomerFieldDialog
          key={dialog.field?.id ?? `new-${dialog.section}`}
          field={dialog.field}
          defaultSection={dialog.section}
          defaults={newFieldDefaults(fieldsOfSection(dialog.section))}
          sections={
            sectionNames.includes(dialog.section) ? sectionNames : [...sectionNames, dialog.section]
          }
          onOpenChange={(open) => !open && setDialog(null)}
          onSubmit={handleSubmit}
        />
      )}

      {sectionOnline && (
        <CustomerFieldSectionOnlineDialog
          key={`${sectionOnline.reason}-${sectionOnline.section}`}
          section={sectionOnline.section}
          fields={fieldsOfSection(sectionOnline.section)}
          reason={sectionOnline.reason}
          onOpenChange={(open) => !open && setSectionOnline(null)}
          onSubmit={handleSectionOnline}
        />
      )}

      <CustomerFieldTemplatesDialog
        open={galleryOpen}
        templates={templates}
        adoptedKeys={adoptedKeys}
        defaultGroup={
          suggestions.some((template) => template.group === "country") ? "country" : "general"
        }
        isPending={adoptTemplate.isPending}
        onOpenChange={setGalleryOpen}
        onAdopt={handleAdopt}
      />

      <CustomerFieldDeleteDialog
        field={deletingField}
        isPending={removeField.isPending}
        onOpenChange={(open) => !open && setDeleting(null)}
        onArchive={(id) => {
          const field = fields.find((entry) => entry.id === id);
          if (field) setActive(field, false);
          setDeleting(null);
        }}
        onConfirm={(id) => removeField.mutate({ id }, { onSettled: () => setDeleting(null) })}
      />
    </div>
  );
};
