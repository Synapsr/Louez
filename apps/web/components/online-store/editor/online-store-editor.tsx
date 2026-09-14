"use client";

import { useState, type CSSProperties, type ReactNode } from "react";

import { usePathname, useRouter } from "next/navigation";

import { useStore } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
import { useTranslations } from "next-intl";

import { Sheet, SheetHeader, SheetPopup, SheetTitle, toastManager } from "@louez/ui";
import { cn } from "@louez/utils";

import { orpc } from "@/lib/orpc/react";

import { OnlineStoreEditorProvider, useOnlineStoreForm } from "../online-store-editor-context";
import { ONLINE_STORE_DEFAULT_SECTION, type OnlineStoreDevice } from "../online-store.constants";
import { usePendingImageUploads } from "../use-pending-image-uploads";
import { useResizablePanel } from "../use-resizable-panel";
import { useUnsavedChangesGuard } from "../use-unsaved-changes-guard";
import {
  type OnlineStoreEditorStore,
  type OnlineStoreFormValues,
  buildOnlineStoreDefaults,
  buildOnlineStorePayload,
  isEmptyPayload,
  listReplacedImages,
  listUnsavedImages,
} from "../util.online-store-form";
import { getOnlineStoreSectionFromPathname } from "../util.online-store-section";
import { OnlineStoreCanvas } from "./online-store-canvas";
import { OnlineStoreDeviceToggle } from "./online-store-device-toggle";
import { OnlineStoreRail } from "./online-store-rail";
import { OnlineStoreResizeHandle } from "./online-store-resize-handle";
import { OnlineStoreTopBar } from "./online-store-top-bar";

/** Panel width bounds in px; the default matches the former fixed column on a laptop. */
const PANEL_DEFAULT_WIDTH = 448;
const PANEL_MIN_WIDTH = 320;
const PANEL_MAX_WIDTH = 760;
const PANEL_WIDTH_STORAGE_KEY = "louez.online-store.panel-width";

interface OnlineStoreEditorProps {
  store: OnlineStoreEditorStore;
  children: ReactNode;
}

/**
 * The whole editor is one form: five sections in one set of values, one
 * save that sends only the sections that changed. Images upload as soon as
 * they are picked and only become the store's on save; until then they are
 * pending and get deleted on reset, on replace, or when the page is left.
 * The section panel is the routed child; the rail and the sketch follow
 * the URL.
 */
export const OnlineStoreEditor = ({ store, children }: OnlineStoreEditorProps) => {
  const router = useRouter();
  const pathname = usePathname();
  const t = useTranslations("dashboard.onlineStore");
  const tErrors = useTranslations("errors");
  const section = getOnlineStoreSectionFromPathname(pathname) ?? ONLINE_STORE_DEFAULT_SECTION;
  const uploads = usePendingImageUploads();
  const [savedValues, setSavedValues] = useState<OnlineStoreFormValues>(() =>
    buildOnlineStoreDefaults(store),
  );
  const [device, setDevice] = useState<OnlineStoreDevice>("desktop");
  const [previewOpen, setPreviewOpen] = useState(false);

  // The variables are the form values, not the procedure input: the payload is
  // derived from the diff against the last save inside the mutation.
  const update = useMutation({
    mutationKey: orpc.dashboard.onlineStore.update.key(),
    mutationFn: async (value: OnlineStoreFormValues) => {
      const payload = buildOnlineStorePayload({ value, baseline: savedValues });
      if (!payload) {
        throw new Error("errors.invalidData");
      }
      if (isEmptyPayload(payload)) {
        return { success: true as const };
      }

      const result = await orpc.dashboard.onlineStore.update.call(payload);
      uploads.settle(listReplacedImages({ value, baseline: savedValues }));

      return result;
    },
  });

  const form = useOnlineStoreForm({
    defaultValues: savedValues,
    onSubmit: async ({ value }) => {
      try {
        await update.mutateAsync(value);
        toastManager.add({ title: t("saved"), type: "success" });
        setSavedValues(value);
        form.reset(value);
        router.refresh();
      } catch (error) {
        toastManager.add({
          title:
            error instanceof Error && error.message === "errors.invalidData"
              ? tErrors("invalidData")
              : tErrors("generic"),
          type: "error",
        });
      }
    },
  });

  const isDirty = useStore(form.store, (state) => state.isDirty);
  useUnsavedChangesGuard(isDirty);
  // The panel width is the one thing the editor remembers per browser.
  const panel = useResizablePanel({
    defaultWidth: PANEL_DEFAULT_WIDTH,
    min: PANEL_MIN_WIDTH,
    max: PANEL_MAX_WIDTH,
    storageKey: PANEL_WIDTH_STORAGE_KEY,
  });

  const handleReset = () => {
    for (const url of listUnsavedImages({ value: form.state.values, baseline: savedValues })) {
      uploads.discard(url);
    }
    form.reset();
  };

  return (
    <OnlineStoreEditorProvider value={{ form, uploads, savedValues, store, device, setDevice }}>
      <form.AppForm>
        <form.Form
          formName="online-store"
          noValidate
          className="flex h-dvh flex-col bg-background"
          data-slot="online-store-editor"
        >
          <OnlineStoreTopBar
            section={section}
            isDirty={isDirty}
            isSaving={update.isPending || uploads.isUploading}
            onReset={handleReset}
            onOpenPreview={() => setPreviewOpen(true)}
          />

          <div
            className={cn(
              "flex min-h-0 flex-1 flex-col lg:flex-row",
              panel.dragging && "cursor-col-resize select-none",
            )}
          >
            <OnlineStoreRail section={section} />

            <div
              style={{ "--panel-width": `${panel.width}px` } as CSSProperties}
              className="min-h-0 flex-1 overflow-y-auto lg:w-(--panel-width) lg:flex-none"
            >
              <div className="mx-auto w-full max-w-2xl p-4 sm:p-6 lg:max-w-none">{children}</div>
            </div>

            <OnlineStoreResizeHandle panel={panel} className="hidden lg:block" />

            <OnlineStoreCanvas section={section} className="hidden lg:block" />
          </div>
        </form.Form>
      </form.AppForm>

      <Sheet open={previewOpen} onOpenChange={setPreviewOpen}>
        <SheetPopup side="bottom" className="h-[88dvh] p-0">
          <SheetHeader className="flex-row items-center gap-3 px-4 pt-4 pe-14">
            <SheetTitle>{t("preview")}</SheetTitle>
            <OnlineStoreDeviceToggle value={device} onChange={setDevice} className="ms-auto" />
          </SheetHeader>
          <OnlineStoreCanvas section={section} className="min-h-0" />
        </SheetPopup>
      </Sheet>
    </OnlineStoreEditorProvider>
  );
};
