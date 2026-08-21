import type { SuperPdpEnrollment } from "@/app/(dashboard)/dashboard/settings/invoicing/queries";

/** Lifecycle statement the store has already sent to the PDP network. */
export type ReceivedInvoiceAction = "none" | "acknowledged" | "accepted" | "refused";

/** Badge variants this inbox draws from. Kept narrow so the mappings stay checkable. */
type ReceivedInvoiceBadgeVariant = "failed" | "progress" | "success" | "tertiary" | "warning";

/** `received` covers an invoice polled before any lifecycle event landed on it. */
export type ReceivedInvoiceStatusSlug =
  | "accepted"
  | "acknowledged"
  | "disputed"
  | "paid"
  | "paymentSent"
  | "received"
  | "refused"
  | "rejected"
  | "validated";

/**
 * `received_invoices.latest_status` holds a raw Super PDP status code, so only
 * the codes the spec pins down are named. Anything else is shown verbatim
 * rather than mistranslated — these are legal lifecycle statuses.
 */
const STATUS_SLUGS_BY_CODE: Record<string, ReceivedInvoiceStatusSlug> = {
  "api:rejected": "rejected",
  "api:validated": "validated",
  "fr:204": "acknowledged",
  "fr:205": "accepted",
  "fr:207": "disputed",
  "fr:210": "refused",
  "fr:211": "paymentSent",
  "fr:212": "paid",
  "fr:213": "rejected",
};

const STATUS_VARIANTS = {
  accepted: "success",
  acknowledged: "progress",
  disputed: "warning",
  paid: "success",
  paymentSent: "progress",
  received: "tertiary",
  refused: "failed",
  rejected: "failed",
  validated: "success",
} satisfies Record<ReceivedInvoiceStatusSlug, ReceivedInvoiceBadgeVariant>;

const ACTION_VARIANTS = {
  accepted: "success",
  acknowledged: "progress",
  none: "tertiary",
  refused: "failed",
} satisfies Record<ReceivedInvoiceAction, ReceivedInvoiceBadgeVariant>;

export type ReceivedInvoiceStatusView = {
  /** Provider code to print as-is when it has no translated name. */
  code: string | null;
  slug: ReceivedInvoiceStatusSlug | null;
  variant: ReceivedInvoiceBadgeVariant;
};

/** Turn a raw provider status code into something the inbox can render. */
export const resolveReceivedInvoiceStatus = (
  latestStatus: string | null,
): ReceivedInvoiceStatusView => {
  if (!latestStatus) {
    return { code: null, slug: "received", variant: STATUS_VARIANTS.received };
  }

  const slug = STATUS_SLUGS_BY_CODE[latestStatus] ?? null;

  return slug === null
    ? { code: latestStatus, slug: null, variant: "tertiary" }
    : { code: latestStatus, slug, variant: STATUS_VARIANTS[slug] };
};

export const resolveReceivedInvoiceActionVariant = (
  ourAction: ReceivedInvoiceAction,
): ReceivedInvoiceBadgeVariant => ACTION_VARIANTS[ourAction];

export type ReceivedInvoiceActionAvailability = {
  canAccept: boolean;
  canAcknowledge: boolean;
  canRefuse: boolean;
};

/**
 * Acknowledging (fr:204) only makes sense once, and accepting or refusing
 * (fr:205 / fr:210) closes the invoice for good — so a decided invoice offers
 * no lifecycle action at all.
 */
export const getReceivedInvoiceActionAvailability = (
  ourAction: ReceivedInvoiceAction,
): ReceivedInvoiceActionAvailability => {
  const isOpen = ourAction === "none" || ourAction === "acknowledged";

  return {
    canAccept: isOpen,
    canAcknowledge: ourAction === "none",
    canRefuse: isOpen,
  };
};

/**
 * Reception is a Super PDP capability: without a live enrollment no supplier
 * invoice can ever reach the store, so the inbox says that instead of
 * pretending to be empty.
 */
export const isPdpReceptionActive = (enrollment: SuperPdpEnrollment | null): boolean =>
  enrollment !== null && enrollment.enabled && enrollment.status !== "disabled";

/**
 * `issue_date` is a calendar date with no time zone. Anchoring it at midday UTC
 * keeps it on the right day once a formatter applies the viewer's zone.
 */
export const parseReceivedInvoiceIssueDate = (issueDate: string): Date =>
  new Date(`${issueDate}T12:00:00Z`);

/** `?page=` is user input: anything that is not a positive integer is page 1. */
export const parsePurchaseInvoicesPage = (rawPage: string | undefined): number => {
  const parsed = Number.parseInt(rawPage ?? "", 10);

  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 1;
};
