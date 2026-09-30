"use client";

import { useState } from "react";

import { DragDropProvider, type DragEndEvent } from "@dnd-kit/react";
import { isSortable } from "@dnd-kit/react/sortable";
import { useStore } from "@tanstack/react-form";
import { Plus } from "lucide-react";
import { useTranslations } from "next-intl";

import type { CustomerFieldScope } from "@louez/types";
import { Button, Card } from "@louez/ui";

import { moveItem } from "@/lib/customers/util.customer-fields";

import { CustomerFieldCanvasRow } from "./customer-field-canvas-row";
import { CustomerFieldDraftRow } from "./customer-field-draft-row";
import { CustomerFieldSectionMenu } from "./customer-field-section-menu";
import { CustomerFieldSectionTitle } from "./customer-field-section-title";
import { useCustomerFieldsBuilder } from "./customer-fields-builder-context";
import type { CanvasSection, CustomerFieldWithUsage } from "./util.customer-fields-builder";

interface CustomerFieldSectionProps {
  scope: CustomerFieldScope;
  section: CanvasSection<CustomerFieldWithUsage>;
  canMoveUp: boolean;
  canMoveDown: boolean;
  /** `card` on the customer record; `plain` inside the rented-unit card. */
  variant: "card" | "plain";
}

/**
 * A section of the form: its title (click to rename), its fields in order
 * (drag to reorder), the field being created when it lands here, and
 * "Ajouter un champ" to add one right here.
 */
export const CustomerFieldSection = ({
  scope,
  section,
  canMoveUp,
  canMoveDown,
  variant,
}: CustomerFieldSectionProps) => {
  const t = useTranslations("dashboard.settings.customerFields");
  const {
    readOnly,
    selection,
    selectField,
    draft,
    draftForm,
    lastAddedSectionKey,
    openPicker,
    openSectionOnline,
    renameLocalSection,
    removeLocalSection,
    actions,
  } = useCustomerFieldsBuilder();
  const [editing, setEditing] = useState(
    section.localKey !== null && section.localKey === lastAddedSectionKey,
  );
  const draftSection = useStore(draftForm.store, (state) => state.values.section);
  const hasDraft = draft !== null && draft.scope === scope && draftSection === section.name;
  const hasFields = section.fields.length > 0;

  const finishReorder = (event: DragEndEvent) => {
    if (event.canceled) return;
    const { source } = event.operation;
    if (!isSortable(source) || source.initialIndex === source.index) return;
    actions.reorderSection(
      scope,
      section.name,
      moveItem(section.fields, source.initialIndex, source.index),
    );
  };

  const rename = (name: string) => {
    if (section.localKey) renameLocalSection(section.localKey, name);
    else actions.renameSection(section.name, name);
  };

  const content = (
    <>
      <div className="flex min-h-9 items-center gap-2 ps-1">
        <div className="min-w-0 flex-1">
          <CustomerFieldSectionTitle
            name={section.name}
            editing={editing}
            editable={!readOnly}
            onEditingChange={setEditing}
            onRename={rename}
          />
        </div>
        {!readOnly && (
          <CustomerFieldSectionMenu
            name={section.name}
            hasFields={hasFields}
            canDelete={section.localKey !== null && !hasDraft}
            canMoveUp={canMoveUp}
            canMoveDown={canMoveDown}
            onOnlineSettings={() => openSectionOnline(section.name)}
            onRename={() => setEditing(true)}
            onMove={(direction) => actions.moveSection(scope, section.name, direction)}
            onDelete={() => section.localKey && removeLocalSection(section.localKey)}
          />
        )}
      </div>

      {(hasFields || hasDraft) && (
        <DragDropProvider onDragEnd={finishReorder}>
          <ul className="flex flex-col gap-1">
            {section.fields.map((field, index) => (
              <CustomerFieldCanvasRow
                key={field.id}
                field={field}
                index={index}
                group={`${scope}:${section.name}`}
                selected={selection?.kind === "field" && selection.id === field.id}
                onSelect={() => selectField(field.id)}
              />
            ))}
            {hasDraft && <CustomerFieldDraftRow />}
          </ul>
        </DragDropProvider>
      )}

      {!hasFields && !hasDraft && (
        <p className="text-muted-foreground ps-8 text-sm">{t("builder.sections.empty")}</p>
      )}

      {!readOnly && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-muted-foreground ms-6.5 self-start"
          onClick={() => openPicker({ scope, section: section.name })}
        >
          <Plus />
          {t("field.add")}
        </Button>
      )}
    </>
  );

  if (variant === "plain") {
    return <section className="flex flex-col gap-2">{content}</section>;
  }
  return <Card className="gap-2 p-3 sm:p-4">{content}</Card>;
};
