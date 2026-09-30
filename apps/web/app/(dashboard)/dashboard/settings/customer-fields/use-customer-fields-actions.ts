"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";

import type { CustomerFieldDefinition, CustomerFieldScope } from "@louez/types";
import { toastManager } from "@louez/ui";

import type { ResolvedCustomerFieldTemplate } from "@/lib/customers/customer-field-templates";
import { getErrorMessageKey } from "@/lib/utils/util.error-message";

import { customerFieldsMutations } from "./customer-fields.queries";
import {
  type CustomerFieldOnlineSettings,
  toCustomerFieldPayload,
} from "./util.customer-field-online";
import {
  type CustomerFieldFormValues,
  type CustomerFieldWithUsage,
  findCreatedField,
  moveFieldPayload,
  moveSectionPayload,
  reorderSectionPayload,
} from "./util.customer-fields-builder";

interface UseCustomerFieldsActionsParams {
  fields: CustomerFieldWithUsage[];
  /** The page's reactions to what the server answered. */
  onCreated: (field: CustomerFieldWithUsage, values: CustomerFieldFormValues) => void;
  onItemTemplateAdopted: (section: string) => void;
  onRemovedFromCanvas: (fieldId: string) => void;
  onSectionRenamed: (from: string, to: string) => void;
}

/**
 * Every write of the editor, with its toast. Each answers with the whole
 * list; the canvas already shows reorders, renames and settings before that.
 */
export const useCustomerFieldsActions = ({
  fields,
  onCreated,
  onItemTemplateAdopted,
  onRemovedFromCanvas,
  onSectionRenamed,
}: UseCustomerFieldsActionsParams) => {
  const t = useTranslations("dashboard.settings.customerFields");
  const tErrors = useTranslations("errors");
  const queryClient = useQueryClient();

  const showError = (error: unknown) => {
    const key = getErrorMessageKey(error);
    toastManager.add({
      title: tErrors.has(key) ? tErrors(key) : tErrors("generic"),
      type: "error",
    });
  };
  const withErrorToast = { onError: showError };

  const create = useMutation(customerFieldsMutations.create(queryClient));
  const adopt = useMutation(customerFieldsMutations.adoptTemplate(queryClient));
  const update = useMutation(customerFieldsMutations.update(queryClient));
  const reorder = useMutation(customerFieldsMutations.reorder(queryClient));
  const rename = useMutation(customerFieldsMutations.renameSection(queryClient));
  const sectionOnline = useMutation(customerFieldsMutations.updateSectionOnline(queryClient));
  const remove = useMutation(customerFieldsMutations.remove(queryClient));

  /** The draft's "Ajouter". A refusal leaves the draft as typed, with the reason in a toast. */
  const createField = async (values: CustomerFieldFormValues) => {
    try {
      const next = await create.mutateAsync(toCustomerFieldPayload(values));
      const created = findCreatedField(fields, next);
      toastManager.add({ title: t("toasts.created"), type: "success" });
      if (created) onCreated(created, values);
    } catch (error) {
      showError(error);
    }
  };

  const adoptTemplate = (template: ResolvedCustomerFieldTemplate) =>
    adopt.mutate(
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
          if (template.scope === "item" && section) onItemTemplateAdopted(section);
        },
        ...withErrorToast,
      },
    );

  const setActive = (field: Pick<CustomerFieldDefinition, "id">, isActive: boolean) => {
    if (!isActive) onRemovedFromCanvas(field.id);
    update.mutate(
      { id: field.id, isActive },
      {
        onSuccess: () =>
          toastManager.add({
            title: t(isActive ? "toasts.restored" : "toasts.archived"),
            type: "success",
          }),
        ...withErrorToast,
      },
    );
  };

  /** "Demander un champ au client": one click asks it, as optional. */
  const askCustomer = (field: Pick<CustomerFieldDefinition, "id">) =>
    update.mutate({ id: field.id, collectMode: "optional" }, withErrorToast);

  const reorderSection = (
    scope: CustomerFieldScope,
    section: string,
    ordered: CustomerFieldWithUsage[],
  ) =>
    reorder.mutate(
      { fields: reorderSectionPayload(fields, scope, section, ordered) },
      withErrorToast,
    );

  const moveField = (field: Pick<CustomerFieldDefinition, "id" | "scope">, target: string) =>
    reorder.mutate({ fields: moveFieldPayload(fields, field, target) }, withErrorToast);

  const moveSection = (scope: CustomerFieldScope, section: string, direction: -1 | 1) =>
    reorder.mutate(
      { fields: moveSectionPayload(fields, scope, section, direction) },
      withErrorToast,
    );

  const renameSection = (from: string, to: string) => {
    onSectionRenamed(from, to);
    rename.mutate(
      { from, to },
      {
        onSuccess: () => toastManager.add({ title: t("toasts.sectionRenamed"), type: "success" }),
        ...withErrorToast,
      },
    );
  };

  /** Resolves to false when refused: the dialog stays open, the toast says why. */
  const applySectionOnline = async (
    section: string,
    settings: CustomerFieldOnlineSettings,
  ): Promise<boolean> => {
    try {
      await sectionOnline.mutateAsync({ section, ...settings });
      toastManager.add({ title: t("toasts.sectionOnlineSaved"), type: "success" });
      return true;
    } catch (error) {
      showError(error);
      return false;
    }
  };

  const removeField = (fieldId: string, onSettled: () => void) =>
    remove.mutate(
      { id: fieldId },
      {
        onSuccess: () => {
          onRemovedFromCanvas(fieldId);
          toastManager.add({ title: t("toasts.deleted"), type: "success" });
        },
        onError: showError,
        onSettled,
      },
    );

  return {
    createField,
    adoptTemplate,
    setActive,
    askCustomer,
    reorderSection,
    moveField,
    moveSection,
    renameSection,
    applySectionOnline,
    removeField,
    isAdopting: adopt.isPending,
    isRemoving: remove.isPending,
  };
};

export type CustomerFieldsActions = ReturnType<typeof useCustomerFieldsActions>;
