/** A box as `getBoundingClientRect` gives it, in CSS pixels. */
export interface LayoutBox {
  top: number;
  right: number;
  bottom: number;
  left: number;
  width: number;
}

/**
 * Where the field inspector goes. `side`: a drawer inside the dashboard panel,
 * on its right, the page pushed left by `push` so the drawer never covers the
 * form. `sheet`: the screen is too narrow for both, the inspector covers it.
 */
export type InspectorDrawerLayout =
  | { mode: "side"; top: number; right: number; bottom: number; width: number; push: number }
  | { mode: "sheet" };

export const INSPECTOR_DRAWER = {
  minWidth: 340,
  maxWidth: 400,
  /** Share of the panel the drawer takes between its two bounds. */
  share: 0.35,
  /** Air between the drawer and the panel's edges. */
  inset: 8,
  /** Air between the pushed page and the drawer. */
  gap: 20,
  /** Below this, the form beside the drawer would be too narrow to read. */
  minCanvas: 280,
  /** Phones always get the inspector full screen. */
  phoneMaxWidth: 640,
} as const;

export const computeInspectorDrawerLayout = ({
  viewport,
  panel,
  frame,
}: {
  viewport: { width: number; height: number };
  /** The dashboard's scrolling panel, which the drawer sits in. */
  panel: LayoutBox;
  /** The page being pushed. */
  frame: Pick<LayoutBox, "left" | "right">;
}): InspectorDrawerLayout => {
  const { minWidth, maxWidth, share, inset, gap, minCanvas, phoneMaxWidth } = INSPECTOR_DRAWER;
  if (viewport.width < phoneMaxWidth) return { mode: "sheet" };

  const width = Math.round(Math.min(maxWidth, Math.max(minWidth, panel.width * share)));
  const drawerLeft = panel.right - inset - width;
  const push = Math.max(0, Math.ceil(frame.right - (drawerLeft - gap)));
  if (frame.right - frame.left - push < minCanvas) return { mode: "sheet" };

  return {
    mode: "side",
    top: Math.round(panel.top + inset),
    right: Math.round(viewport.width - panel.right + inset),
    bottom: Math.round(viewport.height - panel.bottom + inset),
    width,
    push,
  };
};

export const isSameInspectorDrawerLayout = (
  left: InspectorDrawerLayout | null,
  right: InspectorDrawerLayout,
): boolean => {
  if (left === null || left.mode !== right.mode) return false;
  if (left.mode === "sheet" || right.mode === "sheet") return true;
  return (
    left.top === right.top &&
    left.right === right.right &&
    left.bottom === right.bottom &&
    left.width === right.width &&
    left.push === right.push
  );
};
