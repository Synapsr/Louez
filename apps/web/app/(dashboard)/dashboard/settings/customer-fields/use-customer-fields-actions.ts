"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";

import type { CustomerFieldScope, CustomerFieldWidth } from "@louez/types";
import { toastManager } from "@louez/ui";
import {
  type CustomerFormLayoutItem,
  setCustomerFormLayoutItemWidth,
  toCustomerFormLayoutUpdateItems,
} from "@louez/validations";

import type { ResolvedCustomerFieldTemplate } from "@/lib/customers/customer-field-templates";
import { getErrorMessageKey } from "@/lib/utils/util.error-message";

import { customerFieldsMutations, layoutKey } from "./customer-fields.queries";
import {
  type CustomerFieldOnlineSettings,
  toCustomerFieldPayload,
} from "./util.customer-field-online";
import {
  type CustomerFieldFormValues,
  type CustomerFieldWithUsage,
  findAdoptedFields,
} from "./util.customer-fields-builder";
import { moveShownItem } from "./util.customer-form-builder";

type BuilderItem = CustomerFormLayoutItem<CustomerFieldWithUsage>;

interface UseCustomerFieldsActionsParams {
  fields: CustomerFieldWithUsage[];
  /** Each tab's full list, in order: what a move or a resize rearranges. */
  items: Record<CustomerFieldScope, BuilderItem[]>;
  /** The page's reactions to what the server answered. */
  onCreated: () => void;
  onItemTemplateAdopted: (params: { name: string; fieldIds: string[] }) => void;
  onDeleted: (fieldId: string) => void;
}

/**
 * Every write of the page, with its toast. Moves and resizes show at once
 * and are put back if refused; settings changes go through the Sheet's
 * autosave instead.
 */
export const useCustomerFieldsActions = ({
  fields,
  items,
  onCreated,
  onItemTemplateAdopted,
  onDeleted,
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

  const create = useMutation(customerFieldsMutations.create(queryClient));
  const adopt = useMutation(customerFieldsMutations.adoptTemplate(queryClient));
  const update = useMutation(customerFieldsMutations.update(queryClient));
  const remove = useMutation(customerFieldsMutations.remove(queryClient));
  const updateLayout = useMutation(customerFieldsMutations.updateLayout(queryClient));

  /**
   * Puts the tab's new order on screen right away (a drop must not jump
   * back), then saves it; a refusal puts the previous order back.
   */
  const saveLayout = (scope: CustomerFieldScope, next: BuilderItem[]) => {
    const key = layoutKey(scope);
    const previous = queryClient.getQueryData(key);
    queryClient.setQueryData(key, next);
    updateLayout.mutate(
      { scope, items: toCustomerFormLayoutUpdateItems(next) },
      {
        onError: (error) => {
          queryClient.setQueryData(key, previous);
          showError(error);
        },
      },
    );
  };

  /** A drop: `from` and `to` are indexes in `shown`, the items the tab shows right now. */
  const moveItem = (
    scope: CustomerFieldScope,
    shown: readonly BuilderItem[],
    from: number,
    to: number,
  ) => {
    const next = moveShownItem(items[scope], shown, from, to);
    if (next) saveLayout(scope, next);
  };

  const setWidth = (scope: CustomerFieldScope, key: string, width: CustomerFieldWidth) => {
    const current = items[scope].find((item) => item.key === key);
    if (!current || current.fixedWidth || current.width === width) return;
    saveLayout(scope, setCustomerFormLayoutItemWidth(items[scope], key, width));
  };

  /** The draft's "Ajouter". A refusal leaves the draft as typed, with the reason in a toast. */
  const createField = async (values: CustomerFieldFormValues) => {
    try {
      await create.mutateAsync(toCustomerFieldPayload(values));
      toastManager.add({ title: t("toasts.created"), type: "success" });
      onCreated();
    } catch (error) {
      showError(error);
    }
  };

  const adoptTemplate = (template: ResolvedCustomerFieldTemplate) =>
    adopt.mutate(
      { templateKey: template.id, fields: template.fields },
      {
        onSuccess: (next) => {
          const adopted = findAdoptedFields(fields, next, template.id);
          if (adopted.length === 0) return;
          toastManager.add({
            title: t("templates.adoptedToast", { count: adopted.length }),
            type: "success",
          });
          // Per-item fields concern no product until the owner picks them: ask right away.
          if (template.scope === "item") {
            onItemTemplateAdopted({
              name: template.name,
              fieldIds: adopted.map((field) => field.id),
            });
          }
        },
        onError: showError,
      },
    );

  /** "Masquer plutôt" of the delete dialog: the field stays in place, greyed, its values kept. */
  const hideField = (fieldId: string) =>
    update.mutate(
      { id: fieldId, isActive: false },
      {
        onSuccess: () => toastManager.add({ title: t("toasts.hidden"), type: "success" }),
        onError: showError,
      },
    );

  /** "Pour quels produits ?": the same online settings on every field a template just added. */
  const applyOnlineSettings = async (
    fieldIds: readonly string[],
    settings: CustomerFieldOnlineSettings,
  ): Promise<boolean> => {
    try {
      await Promise.all(fieldIds.map((id) => update.mutateAsync({ id, ...settings })));
      toastManager.add({ title: t("builder.toasts.applied"), type: "success" });
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
          onDeleted(fieldId);
          toastManager.add({ title: t("toasts.deleted"), type: "success" });
        },
        onError: showError,
        onSettled,
      },
    );

  return {
    moveItem,
    setWidth,
    createField,
    adoptTemplate,
    hideField,
    applyOnlineSettings,
    removeField,
    isAdopting: adopt.isPending,
    isRemoving: remove.isPending,
  };
};

export type CustomerFieldsActions = ReturnType<typeof useCustomerFieldsActions>;
