"use client";

import { createContext, type ReactNode, useContext, useRef, useState } from "react";

import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";

import type { CustomerFieldScope, CustomerFieldType } from "@louez/types";
import { useControlsDisabled } from "@louez/ui";

import type { StoreThemeInput } from "@/lib/theme/util.store-theme";

import { CANVAS_FIELD_ATTRIBUTE, FIELD_INSPECTOR_ATTRIBUTE } from "./customer-fields.constants";
import {
  customerFieldsListOptions,
  customerProfileSettingsOptions,
} from "./customer-fields.queries";
import { type CustomerFieldForm, useCustomerFieldForm } from "./use-customer-field-form";
import {
  type CustomerFieldsActions,
  useCustomerFieldsActions,
} from "./use-customer-fields-actions";
import { type CanvasFieldRef, toCanvasFieldKey } from "./util.customer-field-canvas";
import { newFieldDefaults } from "./util.customer-field-online";
import {
  type CustomerFieldWithUsage,
  type LocalSection,
  buildDraftValues,
  defaultSectionFor,
  listScopeSections,
  nextSectionName,
} from "./util.customer-fields-builder";

export type BuilderView = "team" | "client";

/** Where the inspector opens: the top, or straight at "Réservation en ligne" (from the client view). */
export type InspectorFocus = "general" | "online";

export type BuilderSelection =
  | (CanvasFieldRef & {
      focus: InspectorFocus;
      /** Changes on every click, so a second click scrolls the inspector again. */
      request: number;
      /** Picked with the keyboard: focus follows into the inspector. */
      fromKeyboard: boolean;
    })
  | { kind: "draft" }
  | null;

export interface SelectFieldOptions {
  focus?: InspectorFocus;
  fromKeyboard?: boolean;
}

export interface BuilderDraft {
  key: string;
  scope: CustomerFieldScope;
  /** The section made to hold it when its scope had none: it goes if the draft does. */
  sectionKey: string | null;
}

/** The type picker, opened for a scope and, from a section, for that section. */
export interface PickerRequest {
  scope: CustomerFieldScope;
  section: string | null;
}

export interface SectionOnlineRequest {
  section: string;
  /** `adopted`: right after a template brought per-unit fields ("Pour quels produits ?"). */
  reason: "menu" | "adopted";
}

export interface CustomerFieldsPageSettings {
  country: string | null;
  productCategory: string | null;
  /** The storefront look, so the client view reads like the real checkout. */
  storeTheme: StoreThemeInput | null;
}

interface CustomerFieldsBuilderContextValue {
  fields: CustomerFieldWithUsage[];
  isLoading: boolean;
  settings: CustomerFieldsPageSettings;
  /** Members without `manage_settings` see everything and change nothing. */
  readOnly: boolean;
  view: BuilderView;
  setView: (view: BuilderView) => void;
  selection: BuilderSelection;
  /** A store field or a Louez profile field: both open the same inspector. */
  selectField: (field: CanvasFieldRef, options?: SelectFieldOptions) => void;
  clearSelection: () => void;
  draft: BuilderDraft | null;
  draftForm: CustomerFieldForm;
  /** `section` null: the last section of the scope, or a new one with the default name. */
  startDraft: (params: {
    scope: CustomerFieldScope;
    section: string | null;
    type: CustomerFieldType;
  }) => void;
  cancelDraft: () => void;
  localSections: LocalSection[];
  /** The section just created: its title opens in edit mode. */
  lastAddedSectionKey: string | null;
  addSection: (scope: CustomerFieldScope) => void;
  renameLocalSection: (key: string, name: string) => void;
  removeLocalSection: (key: string) => void;
  picker: PickerRequest | null;
  openPicker: (request?: Partial<PickerRequest>) => void;
  closePicker: () => void;
  galleryOpen: boolean;
  setGalleryOpen: (open: boolean) => void;
  sectionOnline: SectionOnlineRequest | null;
  openSectionOnline: (section: string) => void;
  closeSectionOnline: () => void;
  deletingId: string | null;
  requestDelete: (id: string) => void;
  closeDelete: () => void;
  actions: CustomerFieldsActions;
}

const CustomerFieldsBuilderContext = createContext<CustomerFieldsBuilderContextValue | null>(null);

interface CustomerFieldsBuilderProviderProps {
  settings: CustomerFieldsPageSettings;
  children: ReactNode;
}

/**
 * The editor's state, shared by the header buttons, the canvas and the
 * inspector: which view, which field is selected, the field being created,
 * the sections created on the page and which dialog is open. Server data
 * stays in React Query.
 */
export const CustomerFieldsBuilderProvider = ({
  settings,
  children,
}: CustomerFieldsBuilderProviderProps) => {
  const t = useTranslations("dashboard.settings.customerFields");
  const tValidation = useTranslations("validation");
  const tErrors = useTranslations("errors");
  const readOnly = useControlsDisabled();
  const { data, isPending } = useQuery(customerFieldsListOptions());
  const { isPending: profilePending } = useQuery(customerProfileSettingsOptions());
  const fields = data ?? [];

  const [view, setView] = useState<BuilderView>("team");
  const [selection, setSelection] = useState<BuilderSelection>(null);
  const [draft, setDraft] = useState<BuilderDraft | null>(null);
  const [localSections, setLocalSections] = useState<LocalSection[]>([]);
  const [lastAddedSectionKey, setLastAddedSectionKey] = useState<string | null>(null);
  const [picker, setPicker] = useState<PickerRequest | null>(null);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [sectionOnline, setSectionOnline] = useState<SectionOnlineRequest | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  // Keys of drafts and new sections only need to be unique on this page.
  const nextKey = useRef(0);
  const makeKey = (prefix: string) => {
    nextKey.current += 1;
    return `${prefix}-${nextKey.current}`;
  };

  /** Leaves the field being created, and the section made for it if it is still empty. */
  const dropDraft = () => {
    const sectionKey = draft?.sectionKey;
    if (sectionKey) {
      setLocalSections((current) => current.filter((section) => section.key !== sectionKey));
    }
    setDraft(null);
  };

  const selectField = (
    field: CanvasFieldRef,
    { focus = "general", fromKeyboard = false }: SelectFieldOptions = {},
  ) => {
    // Picking another field leaves the one being created: it was never saved.
    dropDraft();
    setSelection((current) => ({
      ...field,
      focus,
      fromKeyboard,
      request: (current && current.kind !== "draft" ? current.request : 0) + 1,
    }));
  };

  const clearSelection = () => {
    // Closed from inside the inspector, focus goes back to the field it showed, not to the page.
    const fromInspector = document.activeElement?.closest(`[${FIELD_INSPECTOR_ATTRIBUTE}]`);
    const field =
      fromInspector && selection
        ? document.querySelector<HTMLElement>(
            `[${CANVAS_FIELD_ATTRIBUTE}="${toCanvasFieldKey(selection)}"]`,
          )
        : null;
    dropDraft();
    setSelection(null);
    field?.focus();
  };

  const actions = useCustomerFieldsActions({
    fields,
    onCreated: (created, values) => {
      setDraft(null);
      setLocalSections((current) =>
        current.filter(
          (section) => !(section.scope === values.scope && section.name === values.section),
        ),
      );
      setSelection({
        kind: "field",
        id: created.id,
        focus: "general",
        request: 1,
        fromKeyboard: false,
      });
    },
    onItemTemplateAdopted: (section) => {
      setGalleryOpen(false);
      setPicker(null);
      setSectionOnline({ section, reason: "adopted" });
    },
    onDeleted: (fieldId) =>
      setSelection((current) =>
        current?.kind === "field" && current.id === fieldId ? null : current,
      ),
    onSectionRenamed: (from, to) => {
      if (draft && draftForm.state.values.section === from) {
        draftForm.setFieldValue("section", to);
      }
    },
  });

  const draftForm = useCustomerFieldForm({
    messages: { required: tValidation("required"), optionsRequired: tErrors("optionsRequired") },
    onSubmit: actions.createField,
  });

  const startDraft: CustomerFieldsBuilderContextValue["startDraft"] = ({
    scope,
    section: requested,
    type,
  }) => {
    // A draft replaces the previous one, and the section made for it.
    const kept = localSections.filter((entry) => entry.key !== draft?.sectionKey);
    const sections = listScopeSections(fields, scope, kept);
    const section =
      requested ??
      defaultSectionFor(
        sections,
        scope === "customer" ? t("sections.defaultName") : t("builder.sections.defaultItemName"),
      );
    // A scope without sections gets one, named by default, to show the draft in.
    const sectionKey = sections.some((entry) => entry.name === section) ? null : makeKey("section");
    setLocalSections(sectionKey ? [...kept, { key: sectionKey, scope, name: section }] : kept);
    const { scope: _sectionScope, ...online } = newFieldDefaults(
      fields.filter(
        (field) => field.isActive && field.scope === scope && field.section === section,
      ),
    );
    draftForm.reset(buildDraftValues({ type, scope, section, online }), {
      keepDefaultValues: true,
    });
    setDraft({ key: makeKey("draft"), scope, sectionKey });
    setSelection({ kind: "draft" });
    setPicker(null);
  };

  const addSection = (scope: CustomerFieldScope) => {
    const taken = listScopeSections(fields, scope, localSections).map((section) => section.name);
    const key = makeKey("section");
    setLocalSections((current) => [
      ...current,
      { key, scope, name: nextSectionName(t("builder.sections.newName"), taken) },
    ]);
    setLastAddedSectionKey(key);
  };

  const value: CustomerFieldsBuilderContextValue = {
    fields,
    isLoading: isPending || profilePending,
    settings,
    readOnly,
    view,
    setView,
    selection,
    selectField,
    clearSelection,
    draft,
    draftForm,
    startDraft,
    cancelDraft: clearSelection,
    localSections,
    lastAddedSectionKey,
    addSection,
    renameLocalSection: (key, name) => {
      const renamed = localSections.find((section) => section.key === key);
      if (draft && renamed && draftForm.state.values.section === renamed.name) {
        draftForm.setFieldValue("section", name);
      }
      setLocalSections((current) =>
        current.map((section) => (section.key === key ? { ...section, name } : section)),
      );
    },
    removeLocalSection: (key) =>
      setLocalSections((current) => current.filter((section) => section.key !== key)),
    picker,
    openPicker: (request) =>
      setPicker({ scope: request?.scope ?? "customer", section: request?.section ?? null }),
    closePicker: () => setPicker(null),
    galleryOpen,
    setGalleryOpen: (open) => {
      setGalleryOpen(open);
      if (open) setPicker(null);
    },
    sectionOnline,
    openSectionOnline: (section) => setSectionOnline({ section, reason: "menu" }),
    closeSectionOnline: () => setSectionOnline(null),
    deletingId,
    requestDelete: setDeletingId,
    closeDelete: () => setDeletingId(null),
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
