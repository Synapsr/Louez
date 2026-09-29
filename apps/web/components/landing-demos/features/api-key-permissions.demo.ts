import type { FeatureDemoConfig } from "../feature-demo.types";

// Opens a new key, starts from the read-only preset, then lets it write reservations: the
// preset turns into « Custom ».
export const demo: FeatureDemoConfig = {
  actor: "owner",
  duration: 11800,
  cues: [
    { at: 800, selector: "[data-api-key-create]" },
    { at: 1600, selector: "[data-api-key-create]", click: true },
    { at: 2700, selector: "[data-api-key-preset]" },
    { at: 3500, selector: "[data-api-key-preset]", press: true },
    { at: 4400, selector: '[data-api-key-preset-option="readOnly"]' },
    { at: 5200, selector: '[data-api-key-preset-option="readOnly"]', press: true },
    { at: 6500, selector: '[data-api-key-domain="reservations"]' },
    { at: 7300, selector: '[data-api-key-domain="reservations"]', press: true },
    { at: 8200, selector: '[data-api-key-level="reservations:write"]' },
    { at: 9000, selector: '[data-api-key-level="reservations:write"]', press: true },
  ],
};
