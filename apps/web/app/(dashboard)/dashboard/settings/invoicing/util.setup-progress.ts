import type { PdpTransmissionState } from "./util.pdp-transmission";

/** Ordered steps of the electronic-invoicing setup wizard. */
export const INVOICING_SETUP_STEPS = ["identity", "activation", "transmission"] as const;

export type InvoicingSetupStep = (typeof INVOICING_SETUP_STEPS)[number];

/** Server-derived snapshot of how far the store is in the setup. */
export type InvoicingSetupProgress = {
  identityComplete: boolean;
  /** Whether the store has persisted a legal profile at least once. */
  legalProfileSaved: boolean;
  /** Whether Louez currently issues the store's invoices. */
  emissionEnabled: boolean;
  transmissionState: PdpTransmissionState;
};

export type InvoicingChoice = "emissionAndReception" | "receptionOnly";

/**
 * A saved profile makes the existing boolean a complete persisted choice:
 * `true` enables issuing, while `false` keeps the store on reception only.
 * Before the first valid profile save, no choice has been made yet.
 */
export const resolveSavedInvoicingChoice = (
  progress: InvoicingSetupProgress,
): InvoicingChoice | null => {
  if (!progress.legalProfileSaved) return null;
  if (progress.emissionEnabled) return "emissionAndReception";
  return "receptionOnly";
};

/** The wizard gives way to the manage view once reception is connected. */
export const isInvoicingSetupComplete = (progress: InvoicingSetupProgress): boolean =>
  progress.identityComplete && progress.transmissionState === "connected";

/** Index of the first step whose prerequisite is not met yet. */
export const resolveInitialSetupStep = (progress: InvoicingSetupProgress): number => {
  if (!progress.identityComplete) return 0;
  if (!progress.emissionEnabled && progress.transmissionState === "notConnected") return 1;
  return 2;
};
