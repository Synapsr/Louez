import type { PdpTransmissionState } from "./util.pdp-transmission";

/** Ordered steps of the electronic-invoicing setup wizard. */
export const INVOICING_SETUP_STEPS = ["identity", "activation", "transmission"] as const;

export type InvoicingSetupStep = (typeof INVOICING_SETUP_STEPS)[number];

/** Server-derived snapshot of how far the store is in the setup. */
export type InvoicingSetupProgress = {
  identityComplete: boolean;
  /** The merchant enabled invoicing by Louez (step 2 saved as enabled). */
  invoicingActive: boolean;
  transmissionState: PdpTransmissionState;
};

/** The wizard gives way to the manage view once every step is settled. */
export const isInvoicingSetupComplete = (progress: InvoicingSetupProgress): boolean =>
  progress.identityComplete &&
  progress.invoicingActive &&
  progress.transmissionState !== "notConnected";

/** Index of the first step whose prerequisite is not met yet. */
export const resolveInitialSetupStep = (progress: InvoicingSetupProgress): number => {
  if (!progress.identityComplete) return 0;
  if (!progress.invoicingActive) return 1;
  return 2;
};
