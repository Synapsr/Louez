"use client";

import { useEffect, useRef, useState } from "react";

import type { BuilderSelection } from "./customer-fields-builder-context";
import { CANVAS_FIELD_ATTRIBUTE } from "./customer-fields.constants";
import { toCanvasFieldKey } from "./util.customer-field-canvas";
import {
  type InspectorDrawerLayout,
  type LayoutBox,
  computeInspectorDrawerLayout,
  isSameInspectorDrawerLayout,
} from "./util.inspector-drawer-layout";

/** How long the page takes to make room for the drawer (its padding transition). */
const PUSH_DURATION_MS = 220;

/** The dashboard scrolls inside its own panel, not the window: the drawer sits in that panel. */
const findScrollingPanel = (element: HTMLElement): HTMLElement | null => {
  for (let parent = element.parentElement; parent; parent = parent.parentElement) {
    const { overflowY } = getComputedStyle(parent);
    if (overflowY === "auto" || overflowY === "scroll") return parent;
  }
  return null;
};

const viewportBox = (): LayoutBox => ({
  top: 0,
  left: 0,
  right: window.innerWidth,
  bottom: window.innerHeight,
  width: window.innerWidth,
});

/**
 * The field inspector's place on the page: measured from the dashboard panel
 * (and again whenever it or the window resizes), whether it fits beside the
 * form and how far the page moves over for it. Once it opens or shows another
 * field, that field is brought into view; Escape from the page closes it.
 */
export const useInspectorDrawer = (selection: BuilderSelection, close: () => void) => {
  const frameRef = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<InspectorDrawerLayout | null>(null);
  const open = selection !== null;
  const push = open && layout?.mode === "side" ? layout.push : 0;
  const selectedKey = selection ? toCanvasFieldKey(selection) : null;

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const panel = findScrollingPanel(frame);
    const measure = () => {
      const next = computeInspectorDrawerLayout({
        viewport: { width: window.innerWidth, height: window.innerHeight },
        panel: panel ? panel.getBoundingClientRect() : viewportBox(),
        frame: frame.getBoundingClientRect(),
      });
      setLayout((current) => (isSameInspectorDrawerLayout(current, next) ? current : next));
    };
    measure();
    // Border boxes: the push changes the frame's padding, never its outer size.
    const observer = new ResizeObserver(measure);
    observer.observe(frame, { box: "border-box" });
    if (panel) observer.observe(panel, { box: "border-box" });
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  // The page reflows narrower as the drawer opens: once it has, the field is still in sight.
  useEffect(() => {
    if (!selectedKey) return;
    const timer = window.setTimeout(() => {
      document
        .querySelector(`[${CANVAS_FIELD_ATTRIBUTE}="${selectedKey}"]`)
        ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }, PUSH_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [selectedKey, push]);

  // Escape inside the page is handled where it is pressed; with nothing focused, it lands here.
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && event.target === document.body) close();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, close]);

  return { frameRef, layout, push };
};
