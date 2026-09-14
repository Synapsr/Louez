"use client";

import { useStore } from "@tanstack/react-form";

import { cn } from "@louez/utils";

import { useOnlineStoreEditor } from "../online-store-editor-context";
import { ONLINE_STORE_SECTION_PAGES, type OnlineStoreSection } from "../online-store.constants";
import { StorefrontSketch } from "../sketch/storefront-sketch";

interface OnlineStoreCanvasProps {
  section: OnlineStoreSection;
  className?: string;
}

/**
 * The muted surface the sketch sits on. It re-renders on every keystroke,
 * which is the point: the sketch is the editor's feedback. It does not
 * scroll: the sketch zooms its frame to fit the space it gets here and the
 * page scrolls inside the frame.
 */
export const OnlineStoreCanvas = ({ section, className }: OnlineStoreCanvasProps) => {
  const { form, store, device } = useOnlineStoreEditor();
  const values = useStore(form.store, (state) => state.values);

  return (
    <div
      className={cn("min-w-0 flex-1 overflow-hidden bg-muted/60 p-4 sm:p-6 lg:p-8", className)}
      data-slot="online-store-canvas"
    >
      <StorefrontSketch
        page={ONLINE_STORE_SECTION_PAGES[section]}
        section={section}
        device={device}
        values={values}
        store={store}
      />
    </div>
  );
};
