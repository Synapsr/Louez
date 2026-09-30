"use client";

import { Skeleton } from "@louez/ui";

import { useElementSize } from "@/components/online-store/use-element-size";

import { CustomerFieldAddDialog } from "./customer-field-add-dialog";
import { CustomerFieldDeleteDialog } from "./customer-field-delete-dialog";
import { CustomerFieldInspectorDock } from "./customer-field-inspector-dock";
import { CustomerFieldInspectorSheet } from "./customer-field-inspector-sheet";
import { CustomerFieldSectionOnlineDialog } from "./customer-field-section-online-dialog";
import { CustomerFieldTemplatesDialog } from "./customer-field-templates-dialog";
import { useCustomerFieldsBuilder } from "./customer-fields-builder-context";
import { CustomerFieldsClientCanvas } from "./customer-fields-client-canvas";
import { CustomerFieldsTeamCanvas } from "./customer-fields-team-canvas";
import { CustomerFieldsToolbar } from "./customer-fields-toolbar";
import { useCustomerFieldTemplates } from "./use-customer-field-templates";

/**
 * Below this width the canvas would be squeezed next to the inspector, which
 * then opens as a sheet. Same value as the `@min-[45rem]/builder` queries.
 */
const INSPECTOR_DOCK_MIN_WIDTH = 720;

/** Below this width the view labels would be cut: they lose their audience suffix. */
const COMPACT_TOOLBAR_MAX_WIDTH = 480;

/**
 * Settings → Fiche client as a form builder: the form itself on the canvas
 * (the team's or the customer's), the selected field's settings beside it,
 * docked when there is room, in a sheet otherwise.
 */
export const CustomerFieldsBuilder = () => {
  const {
    fields,
    isLoading,
    view,
    selection,
    picker,
    galleryOpen,
    setGalleryOpen,
    sectionOnline,
    closeSectionOnline,
    deletingId,
    closeDelete,
    clearSelection,
    actions,
  } = useCustomerFieldsBuilder();
  const templates = useCustomerFieldTemplates();
  // Measured, not a breakpoint: the settings menu takes a varying share of the screen.
  const { ref, width } = useElementSize<HTMLDivElement>();
  const isDocked = width >= INSPECTOR_DOCK_MIN_WIDTH;
  const deletingField = fields.find((field) => field.id === deletingId) ?? null;

  return (
    <div
      ref={ref}
      className="@container/builder flex flex-col gap-4"
      onKeyDown={(event) => {
        // Escape on the canvas or in the docked panel closes the selection (drops a draft).
        // Keys pressed in a list, a menu or a dialog opened from here are theirs: those live in portals.
        if (event.key !== "Escape" || !(event.target instanceof Node)) return;
        if (event.currentTarget.contains(event.target)) clearSelection();
      }}
    >
      <CustomerFieldsToolbar compact={width > 0 && width < COMPACT_TOOLBAR_MAX_WIDTH} />

      {isLoading ? (
        <Skeleton className="h-96 w-full rounded-2xl" />
      ) : (
        <div className="grid items-start gap-6 @min-[45rem]/builder:grid-cols-[minmax(0,1fr)_22.5rem] @min-[60rem]/builder:grid-cols-[minmax(0,1fr)_26rem]">
          <div className="@container/canvas min-w-0">
            {view === "team" ? <CustomerFieldsTeamCanvas /> : <CustomerFieldsClientCanvas />}
          </div>
          <div className="hidden self-stretch @min-[45rem]/builder:block">
            <CustomerFieldInspectorDock active={isDocked} />
          </div>
        </div>
      )}

      <CustomerFieldInspectorSheet open={!isDocked && selection !== null} />

      {picker && (
        <CustomerFieldAddDialog key={`${picker.scope}:${picker.section ?? ""}`} request={picker} />
      )}

      <CustomerFieldTemplatesDialog
        open={galleryOpen}
        templates={templates.templates}
        adoptedKeys={templates.adoptedKeys}
        defaultGroup={templates.defaultGroup}
        isPending={actions.isAdopting}
        onOpenChange={setGalleryOpen}
        onAdopt={actions.adoptTemplate}
      />

      {sectionOnline && (
        <CustomerFieldSectionOnlineDialog
          key={`${sectionOnline.reason}-${sectionOnline.section}`}
          section={sectionOnline.section}
          fields={fields.filter(
            (field) => field.isActive && field.section === sectionOnline.section,
          )}
          reason={sectionOnline.reason}
          onOpenChange={(open) => !open && closeSectionOnline()}
          onSubmit={async (settings) => {
            if (await actions.applySectionOnline(sectionOnline.section, settings)) {
              closeSectionOnline();
            }
          }}
        />
      )}

      <CustomerFieldDeleteDialog
        field={deletingField}
        isPending={actions.isRemoving}
        onOpenChange={(open) => !open && closeDelete()}
        onArchive={(id) => {
          actions.setActive({ id }, false);
          closeDelete();
        }}
        onConfirm={(id) => actions.removeField(id, closeDelete)}
      />
    </div>
  );
};
