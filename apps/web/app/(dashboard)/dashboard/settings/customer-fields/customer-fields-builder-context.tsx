"use client";

import { createContext, type ReactNode, useContext, useRef, useState } from "react";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";

import type {
  CustomerFieldScope,
  CustomerFieldType,
  ResolvedCustomerProfileSettings,
} from "@louez/types";
import { useControlsDisabled } from "@louez/ui";
import type { CustomerFormLayoutItem } from "@louez/validations";

import type { StoreThemeInput } from "@/lib/theme/util.store-theme";

import {
  customerFieldsListOptions,
  customerFormLayoutOptions,
  customerProfileSettingsOptions,
} from "./customer-fields.queries";
import { type CustomerFieldForm, useCustomerFieldForm } from "./use-customer-field-form";
import {
  type CustomerFieldsActions,
  useCustomerFieldsActions,
} from "./use-customer-fields-actions";
import { DEFAULT_ONLINE_SETTINGS } from "./util.customer-field-online";
import { type CustomerFieldWithUsage, buildDraftValues } from "./util.customer-fields-builder";
import { type CustomerType, joinCustomerFormItems } from "./util.customer-form-builder";

export type BuilderItem = CustomerFormLayoutItem<CustomerFieldWithUsage>;

/**
 * What the Sheet shows: an item of a tab (a Louez field's key or a field id),
 * or the draft (by its key, so the Sheet keeps it while it slides away).
 */
export type BuilderSelection =
  | { kind: "item"; scope: CustomerFieldScope; key: string }
  | { kind: "draft"; key: string }
  | null;

/** The field being created: in the Sheet, and drawn at the end of its tab. */
export interface BuilderDraft {
  key: string;
  scope: CustomerFieldScope;
}

/** "Pour quels produits ?", right after a template added per-item fields. */
export interface TargetsFollowUp {
  templateName: string;
  fieldIds: string[];
}

export interface CustomerFieldsPageSettings {
  country: string | null;
  productCategory: string | null;
  /** The storefront look, so "Aperçu client" reads like the real checkout. */
  storeTheme: StoreThemeInput | null;
}

interface CustomerFieldsBuilderContextValue {
  settings: CustomerFieldsPageSettings;
  /** Members without `manage_settings` see everything and change nothing. */
  readOnly: boolean;
  isLoading: boolean;
  fields: CustomerFieldWithUsage[];
  profileSettings: ResolvedCustomerProfileSettings | undefined;
  /** Each tab's list, in order, hidden and business items included. */
  items: Record<CustomerFieldScope, BuilderItem[]>;
  tab: CustomerFieldScope;
  setTab: (tab: CustomerFieldScope) => void;
  /** Which customer the "Fiche client" tab previews: a business adds the company fields. */
  customerType: CustomerType;
  setCustomerType: (customerType: CustomerType) => void;
  selection: BuilderSelection;
  selectItem: (scope: CustomerFieldScope, key: string) => void;
  /** Closes the Sheet; a draft goes with it (it was never saved). */
  closeSheet: () => void;
  draft: BuilderDraft | null;
  draftForm: CustomerFieldForm;
  /** A new field of this type at the end of the current tab, its settings open. */
  startDraft: (type: CustomerFieldType) => void;
  pickerOpen: boolean;
  setPickerOpen: (open: boolean) => void;
  galleryOpen: boolean;
  setGalleryOpen: (open: boolean) => void;
  previewOpen: boolean;
  setPreviewOpen: (open: boolean) => void;
  deletingId: string | null;
  requestDelete: (fieldId: string) => void;
  closeDelete: () => void;
  targetsFollowUp: TargetsFollowUp | null;
  closeTargetsFollowUp: () => void;
  actions: CustomerFieldsActions;
}

const CustomerFieldsBuilderContext = createContext<CustomerFieldsBuilderContextValue | null>(null);

interface CustomerFieldsBuilderProviderProps {
  settings: CustomerFieldsPageSettings;
  children: ReactNode;
}

/**
 * The page's state, shared by the header buttons, the two tabs and the
 * Sheets: the tab, the customer type previewed, the item open in the Sheet,
 * the field being created and which dialog is open. Server data stays in
 * React Query; each tab's list is read from it on every render.
 */
export const CustomerFieldsBuilderProvider = ({
  settings,
  children,
}: CustomerFieldsBuilderProviderProps) => {
  const tValidation = useTranslations("validation");
  const tErrors = useTranslations("errors");
  const readOnly = useControlsDisabled();
  const fieldsQuery = useQuery(customerFieldsListOptions());
  const profileQuery = useQuery(customerProfileSettingsOptions());
  const customerLayoutQuery = useQuery(customerFormLayoutOptions("customer"));
  const itemLayoutQuery = useQuery(customerFormLayoutOptions("item"));
  const fields = fieldsQuery.data ?? [];
  const profileSettings = profileQuery.data;

  const items: Record<CustomerFieldScope, BuilderItem[]> = {
    customer: joinCustomerFormItems({
      scope: "customer",
      layout: customerLayoutQuery.data ?? [],
      definitions: fields,
      profileSettings,
    }),
    item: joinCustomerFormItems({
      scope: "item",
      layout: itemLayoutQuery.data ?? [],
      definitions: fields,
      profileSettings,
    }),
  };

  const [tab, setTab] = useState<CustomerFieldScope>("customer");
  const [customerType, setCustomerType] = useState<CustomerType>("individual");
  const [selection, setSelection] = useState<BuilderSelection>(null);
  const [draft, setDraft] = useState<BuilderDraft | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [targetsFollowUp, setTargetsFollowUp] = useState<TargetsFollowUp | null>(null);
  // Drafts only need a key unique on this page, so a new one remounts its Sheet.
  const draftCount = useRef(0);

  const closeSheet = () => {
    setSelection(null);
    setDraft(null);
  };

  const actions = useCustomerFieldsActions({
    fields,
    items,
    onCreated: closeSheet,
    onItemTemplateAdopted: ({ name, fieldIds }) => {
      setGalleryOpen(false);
      setPickerOpen(false);
      setTargetsFollowUp({ templateName: name, fieldIds });
    },
    onDeleted: (fieldId) => {
      setSelection((current) =>
        current?.kind === "item" && current.key === fieldId ? null : current,
      );
    },
  });

  const draftForm = useCustomerFieldForm({
    messages: { required: tValidation("required"), optionsRequired: tErrors("optionsRequired") },
    onSubmit: actions.createField,
  });

  const startDraft = (type: CustomerFieldType) => {
    draftForm.reset(buildDraftValues({ type, scope: tab, online: DEFAULT_ONLINE_SETTINGS }), {
      keepDefaultValues: true,
    });
    draftCount.current += 1;
    const key = `draft-${draftCount.current}`;
    setDraft({ key, scope: tab });
    setSelection({ kind: "draft", key });
    setPickerOpen(false);
  };

  const value: CustomerFieldsBuilderContextValue = {
    settings,
    readOnly,
    isLoading:
      fieldsQuery.isPending ||
      profileQuery.isPending ||
      customerLayoutQuery.isPending ||
      itemLayoutQuery.isPending,
    fields,
    profileSettings,
    items,
    tab,
    setTab,
    customerType,
    setCustomerType,
    selection,
    selectItem: (scope, key) => {
      setDraft(null);
      setSelection({ kind: "item", scope, key });
    },
    closeSheet,
    draft,
    draftForm,
    startDraft,
    pickerOpen,
    setPickerOpen,
    galleryOpen,
    setGalleryOpen: (open) => {
      setGalleryOpen(open);
      if (open) setPickerOpen(false);
    },
    previewOpen,
    setPreviewOpen,
    deletingId,
    requestDelete: setDeletingId,
    closeDelete: () => setDeletingId(null),
    targetsFollowUp,
    closeTargetsFollowUp: () => setTargetsFollowUp(null),
    actions,
  };

  return (
    <CustomerFieldsBuilderContext.Provider value={value}>
      {children}
    </CustomerFieldsBuilderContext.Provider>
  );
};

export const useCustomerFieldsBuilder = (): CustomerFieldsBuilderContextValue => {
  const context = useContext(CustomerFieldsBuilderContext);
  if (!context) {
    throw new Error("useCustomerFieldsBuilder must be used within CustomerFieldsBuilderProvider");
  }
  return context;
};
