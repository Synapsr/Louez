"use client";

import { Skeleton } from "@louez/ui";

import { useElementSize } from "@/components/online-store/use-element-size";

import { CustomerFieldAddDialog } from "./customer-field-add-dialog";
import { CustomerFieldDeleteDialog } from "./customer-field-delete-dialog";
import { CustomerFieldSectionOnlineDialog } from "./customer-field-section-online-dialog";
import { CustomerFieldTemplatesDialog } from "./customer-field-templates-dialog";
import { useCustomerFieldsBuilder } from "./customer-fields-builder-context";
import { CustomerFieldsClientCanvas } from "./customer-fields-client-canvas";
import { CustomerFieldsTeamCanvas } from "./customer-fields-team-canvas";
import { CustomerFieldsToolbar } from "./customer-fields-toolbar";
import { useCustomerFieldTemplates } from "./use-customer-field-templates";

/** Below this width the view labels would be cut: they lose their audience suffix. */
const COMPACT_TOOLBAR_MAX_WIDTH = 480;

/**
 * Settings → Fiche client as a form builder: the form itself on the canvas
 * (the team's or the customer's), across the page's full width. A selected
 * field's settings open in the workspace's drawer.
 */
export const CustomerFieldsBuilder = () => {
  const {
    fields,
    isLoading,
    view,
    picker,
    galleryOpen,
    setGalleryOpen,
    sectionOnline,
    closeSectionOnline,
    deletingId,
    closeDelete,
    actions,
  } = useCustomerFieldsBuilder();
  const templates = useCustomerFieldTemplates();
  // Measured, not a breakpoint: the settings menu and the drawer take a varying share of the screen.
  const { ref, width } = useElementSize<HTMLDivElement>();
  const deletingField = fields.find((field) => field.id === deletingId) ?? null;

  return (
    <div ref={ref} className="@container/builder flex flex-col gap-4">
      <CustomerFieldsToolbar compact={width > 0 && width < COMPACT_TOOLBAR_MAX_WIDTH} />

      {isLoading ? (
        <Skeleton className="h-96 w-full rounded-2xl" />
      ) : (
        <div className="@container/canvas min-w-0">
          {view === "team" ? <CustomerFieldsTeamCanvas /> : <CustomerFieldsClientCanvas />}
        </div>
      )}

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
        onHide={(id) => {
          actions.hideField({ id });
          closeDelete();
        }}
        onConfirm={(id) => actions.removeField(id, closeDelete)}
      />
    </div>
  );
};
