import { EVENEMENTIEL_VERTICAL } from "./evenementiel";
import { SKI_VERTICAL } from "./ski";
import type { DemoVertical, DemoVerticalKey } from "./types";
import { VELO_VERTICAL } from "./velo";

export const DEMO_VERTICALS: Record<DemoVerticalKey, DemoVertical> = {
  ski: SKI_VERTICAL,
  velo: VELO_VERTICAL,
  evenementiel: EVENEMENTIEL_VERTICAL,
};

export { DEMO_VERTICAL_KEYS, isDemoVerticalKey } from "./types";
export type { DemoGuideStep, DemoVertical, DemoVerticalKey } from "./types";
