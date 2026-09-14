import type { OnlineStoreDevice } from "../online-store.constants";
import {
  SKETCH_DESIGN_WIDTH,
  SKETCH_PHONE_BEZEL,
  SKETCH_PHONE_SCREEN_HEIGHT,
} from "./sketch-palette";

/**
 * `zoom` is the frame's CSS zoom, never above 1: a roomy canvas shows the
 * page at its own size. `windowHeight` is the desktop window's height
 * before zoom, so that it fills the canvas.
 */
export type SketchFit =
  | { device: "phone"; zoom: number }
  | { device: "desktop"; zoom: number; windowHeight: number };

interface GetSketchFitInput {
  device: OnlineStoreDevice;
  /** The canvas space the frame may take, in CSS pixels. */
  width: number;
  height: number;
}

/**
 * How the frame fits the canvas. The phone keeps its proportions and shrinks
 * until both its width and its height fit. The desktop window shrinks to the
 * width only, then grows as tall as the canvas. Null until the canvas has
 * been measured.
 */
export const getSketchFit = ({ device, width, height }: GetSketchFitInput): SketchFit | null => {
  if (width <= 0 || height <= 0) {
    return null;
  }

  if (device === "phone") {
    const frameWidth = SKETCH_DESIGN_WIDTH.phone + SKETCH_PHONE_BEZEL * 2;
    const frameHeight = SKETCH_PHONE_SCREEN_HEIGHT + SKETCH_PHONE_BEZEL * 2;
    return { device, zoom: Math.min(1, width / frameWidth, height / frameHeight) };
  }

  const zoom = Math.min(1, width / SKETCH_DESIGN_WIDTH.desktop);
  return { device, zoom, windowHeight: height / zoom };
};
