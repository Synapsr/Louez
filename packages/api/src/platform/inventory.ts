/**
 * Every capability a signed-in store user has in the dashboard and the
 * onboarding, and where it lives today: `"use server"` exports, route
 * handlers, oRPC procedures, hand-written MCP tools. Each one is mapped to the
 * lot that turns it into a procedure, to a handoff (a flow the agent can only
 * start with a link), or to a justified exclusion.
 *
 * This list, not file names, says when "everything" is migrated. The test next
 * to it fails when a `"use server"` export is missing here. Data only: nothing
 * here may import from the app.
 */

export type CapabilityDomain =
  | "reservations"
  | "products"
  | "customers"
  | "categories"
  | "payments"
  | "analytics"
  | "settings"
  | "online_store"
  | "integrations"
  | "team"
  | "billing"
  | "stores"
  | "account"
  | "ai"
  | "sms"
  | "purchase_invoices"
  | "inspections"
  | "inbox"
  | "handoffs"
  | "jobs"
  | "ui";

export type CapabilityLot =
  | "0c"
  | "1"
  | "2a"
  | "2b"
  | "2c"
  | "2d"
  | "2e"
  | "3"
  | "4"
  | "5"
  | "6"
  | "7"
  | "8"
  | "A1";

/** A flow that leaves the API: the procedure hands the user a link (plan, section 7). */
export type CapabilityHandoff =
  | "stripe"
  | "google-oauth"
  | "superpdp"
  | "customer-link"
  | "browser-auth";

export type CapabilitySourceKind = "server-action" | "route" | "orpc" | "mcp-tool";

export interface CapabilitySource {
  kind: CapabilitySourceKind;
  /** Repo-relative file. */
  path: string;
  /** Export name, HTTP method (with the case it covers), `router.procedure`, or tool name. */
  name: string;
}

export type CapabilityPlan =
  | { lot: CapabilityLot }
  | { handoff: CapabilityHandoff; lot: CapabilityLot }
  | { exclude: string };

/** What a confirmation must guard: moves money, deletes, sends to a customer, spends credits. */
export type CapabilitySensitivity = "money" | "destructive" | "send" | "spend";

export interface Capability {
  id: `${CapabilityDomain}.${string}`;
  /** Empty for a capability the plan adds that has no code yet. */
  sources: readonly CapabilitySource[];
  kind: "read" | "write";
  sensitive?: CapabilitySensitivity;
  plan: CapabilityPlan;
  /** `["session"]`: never callable by an agent (no privilege escalation, plan section 2). */
  actors?: readonly ["session"];
  /**
   * Served by exposed procedures on every transport: no server action or
   * hand-written MCP tool is left (a route may remain for the browser, such
   * as the file upload route). The tests hold it to that.
   */
  migrated?: true;
}

/** A `"use server"` module that holds no store-user capability, with the reason. */
export interface OutOfScopeServerModule {
  path: string;
  reason: string;
}

// ---------------------------------------------------------------------------
// Source paths
// ---------------------------------------------------------------------------

const DASH = "apps/web/app/(dashboard)/dashboard";
const ONBOARDING = "apps/web/app/(dashboard)/onboarding";
const ROUTERS = "packages/api/src/routers/dashboard";
const TOOLS = "packages/mcp/src/tools";
const API = "apps/web/app/api";

const SA = {
  passwordAlert:
    "apps/web/app/(dashboard)/(account-security)/dashboard/account/password-alert/actions.ts",
  account: `${DASH}/account/actions.ts`,
  password: `${DASH}/account/password-actions.ts`,
  dashboard: `${DASH}/actions.ts`,
  aiAdvisor: `${DASH}/ai-assistant/actions.ts`,
  aiCredits: `${DASH}/ai-assistant/credit-actions.ts`,
  aiPhone: `${DASH}/ai-assistant/phone-actions.ts`,
  voice: `${DASH}/ai-assistant/voice-provisioning-actions.ts`,
  aiChat: `${DASH}/ai-chat-actions.ts`,
  customers: `${DASH}/customers/actions.ts`,
  product: `${DASH}/products/[id]/actions.ts`,
  purchaseInvoices: `${DASH}/purchase-invoices/actions.ts`,
  referrals: `${DASH}/referrals/actions.ts`,
  inspection: `${DASH}/reservations/[id]/inspection/actions.ts`,
  reservations: `${DASH}/reservations/actions.ts`,
  calendar: `${DASH}/reservations/calendar/actions.ts`,
  dateChange: `${DASH}/reservations/date-change-actions.ts`,
  admin: `${DASH}/settings/admin/actions.ts`,
  billing: `${DASH}/settings/billing/actions.ts`,
  delivery: `${DASH}/settings/delivery/actions.ts`,
  hours: `${DASH}/settings/hours/actions.ts`,
  inspectionSettings: `${DASH}/settings/inspections/actions.ts`,
  integrations: `${DASH}/settings/integrations/actions.ts`,
  invoicing: `${DASH}/settings/invoicing/actions.ts`,
  marketplace: `${DASH}/settings/marketplace/actions.ts`,
  notifications: `${DASH}/settings/notifications/actions.ts`,
  payments: `${DASH}/settings/payments/actions.ts`,
  promoCodes: `${DASH}/settings/promo-codes/actions.ts`,
  reviewBooster: `${DASH}/settings/review-booster/actions.ts`,
  taxes: `${DASH}/settings/taxes/actions.ts`,
  sms: `${DASH}/sms/actions.ts`,
  subscription: `${DASH}/subscription/actions.ts`,
  whatsNew: `${DASH}/whats-new/actions.ts`,
  onboardingProfile: `${ONBOARDING}/profile-actions.ts`,
  reeent: `${ONBOARDING}/reeent/actions.ts`,
  multiStore: "apps/web/app/multi-store/actions.ts",
  invoices: "apps/web/lib/invoicing/actions.ts",
} as const;

const ROUTE = {
  handoffReturn: "apps/web/app/handoffs/return/[id]/[state]/route.ts",
  aiImageEnhance: `${API}/ai/product-image/enhance/route.ts`,
  aiChat: `${API}/chat/route.ts`,
  aiCredits: `${API}/dashboard/ai-credits/route.ts`,
  export: `${API}/export/route.ts`,
  exportContracts: `${API}/export/contracts/route.ts`,
  files: `${API}/files/[kind]/route.ts`,
  inspectionReport: `${API}/inspections/[id]/report/route.ts`,
  googleCalendarStart: `${API}/integrations/google-calendar/oauth/start/route.ts`,
  superPdpStart: `${API}/integrations/superpdp/oauth/start/route.ts`,
  purchaseInvoice: `${API}/purchase-invoices/[receivedInvoiceId]/route.ts`,
  contract: `${API}/reservations/[id]/contract/route.ts`,
  invoice: `${API}/reservations/[id]/invoices/[invoiceId]/route.ts`,
  voicePreview: `${API}/voice/preview/route.ts`,
  voiceRecording: `${API}/voice/recording/[conversationId]/route.ts`,
} as const;

/** oRPC router file per key of `dashboardRouter`. */
const ORPC = {
  account: `${ROUTERS}/account.ts`,
  agentConnections: `${ROUTERS}/agent-connections.ts`,
  aiAdvisor: `${ROUTERS}/ai-advisor.ts`,
  analytics: `${ROUTERS}/analytics.ts`,
  apiKeys: `${ROUTERS}/api-keys.ts`,
  billing: `${ROUTERS}/billing.ts`,
  categories: `${ROUTERS}/categories.ts`,
  customerFields: `${ROUTERS}/customer-fields.ts`,
  customers: `${ROUTERS}/customers.ts`,
  handoffs: `${ROUTERS}/handoffs.ts`,
  inbox: `${ROUTERS}/inbox.ts`,
  integrations: `${ROUTERS}/integrations.ts`,
  jobs: `${ROUTERS}/jobs.ts`,
  notifications: `${ROUTERS}/notifications.ts`,
  onboarding: `${ROUTERS}/onboarding.ts`,
  onlineStore: `${ROUTERS}/online-store.ts`,
  payments: `${ROUTERS}/payments.ts`,
  products: `${ROUTERS}/products.ts`,
  referral: `${ROUTERS}/referral.ts`,
  reservationDetails: `${ROUTERS}/reservation-details.ts`,
  reservations: `${ROUTERS}/reservations.ts`,
  search: `${ROUTERS}/search.ts`,
  settings: `${ROUTERS}/settings.ts`,
  stores: `${ROUTERS}/stores.ts`,
  team: `${ROUTERS}/team.ts`,
} as const;

const MCP = {
  calendar: `${TOOLS}/calendar.ts`,
  customers: `${TOOLS}/customers.ts`,
  payments: `${TOOLS}/payments.ts`,
} as const;

const action = (path: string, name: string): CapabilitySource => ({
  kind: "server-action",
  path,
  name,
});
const route = (path: string, name: string): CapabilitySource => ({ kind: "route", path, name });
const procedure = (router: keyof typeof ORPC, name: string): CapabilitySource => ({
  kind: "orpc",
  path: ORPC[router],
  name: `${router}.${name}`,
});
const tool = (path: string, name: string): CapabilitySource => ({ kind: "mcp-tool", path, name });

const UI_ONLY = "Interface preference, no business effect";
const PASSWORD = "Password and passkeys stay with Better Auth, in the browser";

// ---------------------------------------------------------------------------
// Inventory
// ---------------------------------------------------------------------------

export const capabilities = [
  // --- Reservations: follow-up (2a) --------------------------------------
  {
    // The list also gives the counts per dashboard tab.
    id: "reservations.list",
    sources: [procedure("reservations", "list")],
    kind: "read",
    plan: { lot: "2a" },
    migrated: true,
  },
  {
    id: "reservations.get",
    sources: [procedure("reservations", "get")],
    kind: "read",
    plan: { lot: "2a" },
    migrated: true,
  },
  {
    id: "reservations.poll",
    sources: [procedure("reservations", "poll")],
    kind: "read",
    plan: { lot: "2a" },
    migrated: true,
  },
  {
    id: "reservations.listCalendarPeriod",
    sources: [procedure("reservations", "listCalendarPeriod")],
    kind: "read",
    plan: { lot: "2a" },
    migrated: true,
  },
  {
    id: "reservations.getPlanningTimeline",
    sources: [procedure("reservations", "getPlanningTimeline")],
    kind: "read",
    plan: { lot: "2a" },
    migrated: true,
  },
  {
    id: "reservations.listUpcoming",
    sources: [procedure("reservations", "listUpcoming")],
    kind: "read",
    plan: { lot: "2a" },
    migrated: true,
  },
  {
    id: "reservations.listOverdue",
    sources: [procedure("reservations", "listOverdue")],
    kind: "read",
    plan: { lot: "2a" },
    migrated: true,
  },
  {
    id: "reservations.updateStatus",
    sources: [procedure("reservations", "updateStatus")],
    kind: "write",
    sensitive: "send",
    plan: { lot: "2a" },
    migrated: true,
  },
  {
    id: "reservations.cancel",
    sources: [procedure("reservations", "cancel")],
    kind: "write",
    sensitive: "destructive",
    plan: { lot: "2a" },
    migrated: true,
  },
  {
    id: "reservations.updateNotes",
    sources: [procedure("reservations", "updateNotes")],
    kind: "write",
    plan: { lot: "2a" },
    migrated: true,
  },
  {
    id: "ui.globalSearch",
    sources: [procedure("search", "global")],
    kind: "read",
    plan: { lot: "2a" },
    migrated: true,
  },

  // --- Inbox (A1): what needs the store's attention, served by procedures --
  {
    id: "inbox.list",
    sources: [procedure("inbox", "list")],
    kind: "read",
    plan: { lot: "A1" },
    migrated: true,
  },
  {
    id: "inbox.acknowledge",
    sources: [procedure("inbox", "acknowledge")],
    kind: "write",
    plan: { lot: "A1" },
    migrated: true,
  },

  // --- Handoffs (6): a step only the user can take, started by an agent ---
  {
    id: "handoffs.get",
    sources: [procedure("handoffs", "get")],
    kind: "read",
    plan: { lot: "6" },
    migrated: true,
  },
  {
    // Asks the provider again for a step the user came back from (the billing card).
    id: "handoffs.refresh",
    sources: [procedure("handoffs", "refresh")],
    kind: "write",
    plan: { lot: "6" },
    migrated: true,
  },
  {
    // A person's answer on a step's page (an agent's team invitation): a
    // session only, so no agent grants itself access or decides for a person.
    id: "handoffs.decide",
    sources: [procedure("handoffs", "decide")],
    kind: "write",
    sensitive: "send",
    plan: { lot: "6" },
    actors: ["session"],
  },

  // --- Background jobs (7): work a call starts, such as an AI photo -------
  {
    id: "jobs.get",
    sources: [procedure("jobs", "get")],
    kind: "read",
    plan: { lot: "7" },
    migrated: true,
  },

  // --- Reservations: creation and changes (2b) ---------------------------
  {
    id: "reservations.checkAvailability",
    sources: [
      action(SA.reservations, "getManualReservationAvailability"),
      tool(MCP.calendar, "check_availability"),
    ],
    kind: "read",
    plan: { lot: "2b" },
  },
  {
    id: "reservations.listCustomerOptions",
    sources: [action(SA.reservations, "getStoreCustomers")],
    kind: "read",
    plan: { lot: "2b" },
  },
  {
    id: "reservations.listProductOptions",
    sources: [action(SA.reservations, "getStoreProducts")],
    kind: "read",
    plan: { lot: "2b" },
  },
  {
    id: "reservations.previewManualInsuranceQuote",
    sources: [
      action(SA.reservations, "previewManualReservationTulipQuote"),
      procedure("reservations", "previewManualTulipQuote"),
    ],
    kind: "read",
    plan: { lot: "2b" },
  },
  {
    id: "reservations.createManual",
    sources: [
      action(SA.reservations, "createManualReservation"),
      procedure("reservations", "createManualReservation"),
    ],
    kind: "write",
    plan: { lot: "2b" },
  },
  {
    id: "reservations.getEditContext",
    sources: [procedure("reservations", "getEditContext")],
    kind: "read",
    plan: { lot: "2b" },
  },
  {
    id: "reservations.previewInsuranceQuote",
    sources: [
      action(SA.reservations, "previewReservationTulipQuote"),
      procedure("reservations", "previewTulipQuote"),
    ],
    kind: "read",
    plan: { lot: "2b" },
  },
  {
    id: "reservations.update",
    sources: [
      action(SA.reservations, "updateReservation"),
      procedure("reservations", "updateReservation"),
    ],
    kind: "write",
    plan: { lot: "2b" },
  },
  {
    id: "reservations.updateBilling",
    sources: [procedure("reservations", "updateBilling")],
    kind: "write",
    plan: { lot: "2b" },
  },
  {
    id: "reservations.getItemDetails",
    sources: [procedure("reservationDetails", "itemDetails")],
    kind: "read",
    plan: { lot: "2b" },
  },
  {
    id: "reservations.updateItemDetails",
    sources: [procedure("reservationDetails", "updateItemDetails")],
    kind: "write",
    plan: { lot: "2b" },
  },
  {
    id: "reservations.rejectReturnDateChange",
    sources: [action(SA.dateChange, "rejectReturnDateChange")],
    kind: "write",
    plan: { lot: "2b" },
  },
  {
    id: "reservations.sendModificationEmail",
    sources: [
      action(SA.reservations, "sendReservationModificationEmail"),
      procedure("reservations", "sendModificationEmail"),
    ],
    kind: "write",
    sensitive: "send",
    plan: { lot: "2b" },
  },

  // --- Money (2c) ---------------------------------------------------------
  {
    id: "payments.list",
    sources: [tool(MCP.payments, "list_payments")],
    kind: "read",
    plan: { lot: "2c" },
  },
  {
    id: "payments.listPayouts",
    sources: [procedure("payments", "payouts")],
    kind: "read",
    plan: { lot: "2c" },
  },
  {
    id: "reservations.getPaymentMethod",
    sources: [
      action(SA.reservations, "getReservationPaymentMethod"),
      procedure("reservations", "getPaymentMethod"),
    ],
    kind: "read",
    plan: { lot: "2c" },
  },
  {
    id: "reservations.recordPayment",
    sources: [
      action(SA.reservations, "recordPayment"),
      procedure("reservations", "recordPayment"),
      procedure("payments", "record"),
    ],
    kind: "write",
    sensitive: "money",
    plan: { lot: "2c" },
  },
  {
    id: "reservations.refundManualPayment",
    sources: [
      action(SA.reservations, "refundManualPayment"),
      procedure("reservations", "refundManualPayment"),
    ],
    kind: "write",
    sensitive: "money",
    plan: { lot: "2c" },
  },
  {
    id: "reservations.refundStripePayment",
    sources: [action(SA.reservations, "processStripeRefund")],
    kind: "write",
    sensitive: "money",
    plan: { lot: "2c" },
  },
  {
    id: "reservations.deletePayment",
    sources: [
      action(SA.reservations, "deletePayment"),
      procedure("reservations", "deletePayment"),
      procedure("payments", "delete"),
    ],
    kind: "write",
    sensitive: "destructive",
    plan: { lot: "2c" },
  },
  {
    id: "reservations.returnDeposit",
    sources: [
      action(SA.reservations, "returnDeposit"),
      procedure("reservations", "returnDeposit"),
      procedure("payments", "recordDepositReturn"),
    ],
    kind: "write",
    sensitive: "money",
    plan: { lot: "2c" },
  },
  {
    id: "reservations.recordDamage",
    sources: [action(SA.reservations, "recordDamage"), procedure("reservations", "recordDamage")],
    kind: "write",
    sensitive: "money",
    plan: { lot: "2c" },
  },
  {
    id: "reservations.createDepositHold",
    sources: [
      action(SA.reservations, "createDepositHold"),
      procedure("reservations", "createDepositHold"),
    ],
    kind: "write",
    sensitive: "money",
    plan: { lot: "2c" },
  },
  {
    id: "reservations.captureDepositHold",
    sources: [
      action(SA.reservations, "captureDepositHold"),
      procedure("reservations", "captureDepositHold"),
    ],
    kind: "write",
    sensitive: "money",
    plan: { lot: "2c" },
  },
  {
    id: "reservations.releaseDepositHold",
    sources: [
      action(SA.reservations, "releaseDepositHold"),
      procedure("reservations", "releaseDepositHold"),
    ],
    kind: "write",
    sensitive: "money",
    plan: { lot: "2c" },
  },
  {
    // The store resolves a deposit hold Stripe has not confirmed, on its word: a session
    // only (the procedure says why).
    id: "reservations.resolveDepositAttempt",
    sources: [procedure("reservations", "resolveDepositAttempt")],
    kind: "write",
    sensitive: "money",
    plan: { lot: "2c" },
    actors: ["session"],
  },
  {
    id: "reservations.requestPayment",
    sources: [
      action(SA.reservations, "requestPayment"),
      procedure("reservations", "requestPayment"),
    ],
    kind: "write",
    sensitive: "send",
    plan: { lot: "2c" },
  },

  // --- Customer communication (2d) ---------------------------------------
  {
    id: "reservations.getEmailRenderContext",
    sources: [
      action(SA.reservations, "getManualEmailRenderContext"),
      procedure("reservations", "getEmailRenderContext"),
    ],
    kind: "read",
    plan: { lot: "2d" },
  },
  {
    id: "reservations.sendEmail",
    sources: [
      action(SA.reservations, "sendReservationEmail"),
      procedure("reservations", "sendReservationEmail"),
    ],
    kind: "write",
    sensitive: "send",
    plan: { lot: "2d" },
  },
  {
    id: "reservations.generateAccessUrl",
    sources: [action(SA.reservations, "generateAccessUrl")],
    kind: "write",
    plan: { lot: "2d" },
  },
  {
    id: "reservations.sendAccessLink",
    sources: [
      action(SA.reservations, "sendAccessLink"),
      procedure("reservations", "sendAccessLink"),
    ],
    kind: "write",
    sensitive: "send",
    plan: { lot: "2d" },
  },
  {
    id: "reservations.checkSmsConfigured",
    sources: [action(SA.reservations, "checkSmsConfigured")],
    kind: "read",
    plan: { lot: "2d" },
  },
  {
    id: "reservations.sendAccessLinkBySms",
    sources: [
      action(SA.reservations, "sendAccessLinkBySms"),
      procedure("reservations", "sendAccessLinkBySms"),
    ],
    kind: "write",
    sensitive: "send",
    plan: { lot: "2d" },
  },
  {
    id: "settings.getCustomerNotificationTemplate",
    sources: [procedure("notifications", "getCustomerTemplate")],
    kind: "read",
    plan: { lot: "2d" },
  },
  {
    id: "settings.updateCustomerNotificationTemplate",
    sources: [procedure("notifications", "updateCustomerTemplate")],
    kind: "write",
    plan: { lot: "2d" },
  },

  // --- Units, inspections, documents (2e) --------------------------------
  {
    id: "reservations.listAvailableUnits",
    sources: [
      action(SA.reservations, "getAvailableUnitsForReservationItem"),
      procedure("reservations", "getAvailableUnitsForItem"),
    ],
    kind: "read",
    plan: { lot: "2e" },
  },
  {
    id: "reservations.assignUnits",
    sources: [
      action(SA.reservations, "assignUnitsToReservationItem"),
      procedure("reservations", "assignUnitsToItem"),
    ],
    kind: "write",
    plan: { lot: "2e" },
  },
  {
    id: "reservations.reassignItemUnit",
    sources: [action(SA.product, "reassignReservationItemUnit")],
    kind: "write",
    plan: { lot: "2e" },
  },
  {
    id: "reservations.getContract",
    sources: [route(ROUTE.contract, "GET")],
    kind: "read",
    plan: { lot: "2e" },
  },
  {
    id: "reservations.signContractInStore",
    sources: [procedure("reservations", "signInStore")],
    kind: "write",
    plan: { lot: "2e" },
  },
  {
    id: "reservations.generateInvoice",
    sources: [action(SA.invoices, "generateInvoiceForReservation")],
    kind: "write",
    plan: { lot: "2e" },
  },
  {
    id: "reservations.recheckInvoiceTransmission",
    sources: [action(SA.invoices, "recheckInvoiceTransmission")],
    kind: "write",
    plan: { lot: "2e" },
  },
  {
    id: "reservations.getInvoiceDocument",
    sources: [route(ROUTE.invoice, "GET")],
    kind: "read",
    plan: { lot: "2e" },
  },
  {
    id: "inspections.listForReservation",
    sources: [action(SA.inspection, "getReservationInspections")],
    kind: "read",
    plan: { lot: "2e" },
  },
  {
    id: "inspections.get",
    sources: [action(SA.inspection, "getInspection")],
    kind: "read",
    plan: { lot: "2e" },
  },
  {
    id: "inspections.create",
    sources: [action(SA.inspection, "createInspection")],
    kind: "write",
    plan: { lot: "2e" },
  },
  {
    id: "inspections.uploadPhoto",
    sources: [route(ROUTE.files, "POST (kind=inspection)")],
    kind: "write",
    plan: { lot: "2e" },
  },
  {
    id: "inspections.deletePhoto",
    sources: [action(SA.inspection, "deleteInspectionPhoto")],
    kind: "write",
    sensitive: "destructive",
    plan: { lot: "2e" },
  },
  {
    id: "inspections.complete",
    sources: [action(SA.inspection, "completeInspection")],
    kind: "write",
    plan: { lot: "2e" },
  },
  {
    // The customer's signature: only the customer gives it, through a link.
    id: "inspections.sign",
    sources: [action(SA.inspection, "signInspection")],
    kind: "write",
    plan: { handoff: "customer-link", lot: "2e" },
  },
  {
    id: "inspections.getReport",
    sources: [route(ROUTE.inspectionReport, "GET")],
    kind: "read",
    plan: { lot: "2e" },
  },

  // --- Products (3a): served by procedures on every transport -------------
  {
    id: "products.list",
    sources: [procedure("products", "list")],
    kind: "read",
    plan: { lot: "3" },
    migrated: true,
  },
  {
    id: "products.get",
    sources: [procedure("products", "get")],
    kind: "read",
    plan: { lot: "3" },
    migrated: true,
  },
  {
    id: "products.listUnits",
    sources: [procedure("products", "listUnits")],
    kind: "read",
    plan: { lot: "3" },
    migrated: true,
  },
  {
    id: "products.create",
    sources: [procedure("products", "create")],
    kind: "write",
    plan: { lot: "3" },
    migrated: true,
  },
  {
    // Sensitive when it archives, deletes tiers and seasons (fixed pricing)
    // or deletes units.
    id: "products.update",
    sources: [procedure("products", "update")],
    kind: "write",
    sensitive: "destructive",
    plan: { lot: "3" },
    migrated: true,
  },
  {
    // Sensitive when it archives.
    id: "products.updateStatus",
    sources: [procedure("products", "updateStatus")],
    kind: "write",
    sensitive: "destructive",
    plan: { lot: "3" },
    migrated: true,
  },
  {
    id: "products.delete",
    sources: [procedure("products", "delete")],
    kind: "write",
    sensitive: "destructive",
    plan: { lot: "3" },
    migrated: true,
  },
  {
    id: "products.duplicate",
    sources: [procedure("products", "duplicate")],
    kind: "write",
    plan: { lot: "3" },
    migrated: true,
  },
  {
    id: "products.reorder",
    sources: [procedure("products", "reorder")],
    kind: "write",
    plan: { lot: "3" },
    migrated: true,
  },
  {
    // The dashboard still sends the bytes through its file route (progress,
    // same-origin); agents use the two procedures, or send the bytes or a
    // public URL in one call (uploadImage).
    id: "products.uploadImage",
    sources: [
      route(ROUTE.files, "POST (kind=product)"),
      procedure("products", "createImageUpload"),
      procedure("products", "completeImageUpload"),
      procedure("products", "uploadImage"),
    ],
    kind: "write",
    plan: { lot: "3" },
    migrated: true,
  },
  {
    // The dashboard keeps its route (operation=enhance) over the same core as
    // the job (apps/web lib/ai/image/product-image-run.ts); agents start a job.
    id: "products.enhanceImage",
    sources: [
      route(ROUTE.aiImageEnhance, "POST (operation=enhance)"),
      procedure("products", "enhanceImage"),
    ],
    kind: "write",
    sensitive: "spend",
    plan: { lot: "7" },
    migrated: true,
  },
  {
    id: "products.removeImageBackground",
    sources: [
      route(ROUTE.aiImageEnhance, "POST (operation=remove-background)"),
      procedure("products", "removeImageBackground"),
    ],
    kind: "write",
    sensitive: "spend",
    plan: { lot: "7" },
    migrated: true,
  },
  {
    // The dashboard's photo history drawer picks a version in the form, saved with products.update.
    id: "products.useImageVersion",
    sources: [procedure("products", "useImageVersion")],
    kind: "write",
    plan: { lot: "7" },
    migrated: true,
  },
  {
    id: "products.getActivity",
    sources: [procedure("products", "getActivity")],
    kind: "read",
    plan: { lot: "3" },
    migrated: true,
  },
  {
    id: "products.getReservationTimeline",
    sources: [procedure("products", "getReservationTimeline")],
    kind: "read",
    plan: { lot: "3" },
    migrated: true,
  },
  {
    id: "products.listSeasonalPricings",
    sources: [procedure("products", "listSeasonalPricings")],
    kind: "read",
    plan: { lot: "3" },
    migrated: true,
  },
  {
    id: "products.createSeasonalPricing",
    sources: [procedure("products", "createSeasonalPricing")],
    kind: "write",
    plan: { lot: "3" },
    migrated: true,
  },
  {
    id: "products.updateSeasonalPricing",
    sources: [procedure("products", "updateSeasonalPricing")],
    kind: "write",
    plan: { lot: "3" },
    migrated: true,
  },
  {
    id: "products.duplicateSeasonalPricing",
    sources: [procedure("products", "duplicateSeasonalPricing")],
    kind: "write",
    plan: { lot: "3" },
    migrated: true,
  },
  {
    id: "products.deleteSeasonalPricing",
    sources: [procedure("products", "deleteSeasonalPricing")],
    kind: "write",
    sensitive: "destructive",
    plan: { lot: "3" },
    migrated: true,
  },

  // --- Units, downtimes and variants (3b): served by procedures --------------
  {
    id: "products.getUnitHistory",
    sources: [procedure("products", "getUnitHistory")],
    kind: "read",
    plan: { lot: "3" },
    migrated: true,
  },
  {
    // Sensitive when the downtime overlaps reservations that hold the unit.
    id: "products.declareDowntime",
    sources: [procedure("products", "declareDowntime")],
    kind: "write",
    sensitive: "destructive",
    plan: { lot: "3" },
    migrated: true,
  },
  {
    // Sensitive when the new dates overlap reservations that hold the unit.
    id: "products.updateDowntime",
    sources: [procedure("products", "updateDowntime")],
    kind: "write",
    sensitive: "destructive",
    plan: { lot: "3" },
    migrated: true,
  },
  {
    id: "products.closeDowntime",
    sources: [procedure("products", "closeDowntime")],
    kind: "write",
    plan: { lot: "3" },
    migrated: true,
  },
  {
    id: "products.deleteDowntime",
    sources: [procedure("products", "deleteDowntime")],
    kind: "write",
    sensitive: "destructive",
    plan: { lot: "3" },
    migrated: true,
  },
  {
    // Takes the unit out of the stock: always confirmed by an agent.
    id: "products.retireUnit",
    sources: [procedure("products", "retireUnit")],
    kind: "write",
    sensitive: "destructive",
    plan: { lot: "3" },
    migrated: true,
  },
  {
    id: "products.reinstateUnit",
    sources: [procedure("products", "reinstateUnit")],
    kind: "write",
    plan: { lot: "3" },
    migrated: true,
  },
  {
    id: "products.updateUnitDetails",
    sources: [procedure("products", "updateUnitDetails")],
    kind: "write",
    plan: { lot: "3" },
    migrated: true,
  },
  {
    id: "products.listVariants",
    sources: [procedure("products", "listVariants")],
    kind: "read",
    plan: { lot: "3" },
    migrated: true,
  },
  {
    id: "products.ensureVariantDefinition",
    sources: [procedure("products", "ensureVariantDefinition")],
    kind: "write",
    plan: { lot: "3" },
    migrated: true,
  },
  {
    id: "products.updateVariantDefinition",
    sources: [procedure("products", "updateVariantDefinition")],
    kind: "write",
    plan: { lot: "3" },
    migrated: true,
  },
  {
    id: "products.setVariantDefinitionActive",
    sources: [procedure("products", "setVariantDefinitionActive")],
    kind: "write",
    plan: { lot: "3" },
    migrated: true,
  },
  {
    id: "products.deleteVariantDefinition",
    sources: [procedure("products", "deleteVariantDefinition")],
    kind: "write",
    sensitive: "destructive",
    plan: { lot: "3" },
    migrated: true,
  },
  {
    id: "products.getVariantUsage",
    sources: [procedure("products", "getVariantUsage")],
    kind: "read",
    plan: { lot: "3" },
    migrated: true,
  },
  {
    id: "products.withdrawVariantFromProducts",
    sources: [procedure("products", "withdrawVariantFromProducts")],
    kind: "write",
    sensitive: "destructive",
    plan: { lot: "3" },
    migrated: true,
  },
  {
    id: "products.createVariantValue",
    sources: [procedure("products", "createVariantValue")],
    kind: "write",
    plan: { lot: "3" },
    migrated: true,
  },
  {
    id: "products.updateVariantValue",
    sources: [procedure("products", "updateVariantValue")],
    kind: "write",
    plan: { lot: "3" },
    migrated: true,
  },
  {
    id: "products.deleteVariantValue",
    sources: [procedure("products", "deleteVariantValue")],
    kind: "write",
    sensitive: "destructive",
    plan: { lot: "3" },
    migrated: true,
  },

  // --- Categories (0c pilot): served by procedures on every transport ------
  {
    id: "categories.list",
    sources: [procedure("categories", "list")],
    kind: "read",
    plan: { lot: "0c" },
    migrated: true,
  },
  {
    id: "categories.get",
    sources: [procedure("categories", "get")],
    kind: "read",
    plan: { lot: "0c" },
    migrated: true,
  },
  {
    id: "categories.create",
    sources: [procedure("categories", "create")],
    kind: "write",
    plan: { lot: "0c" },
    migrated: true,
  },
  {
    id: "categories.update",
    sources: [procedure("categories", "update")],
    kind: "write",
    plan: { lot: "0c" },
    migrated: true,
  },
  {
    id: "categories.delete",
    sources: [procedure("categories", "delete")],
    kind: "write",
    sensitive: "destructive",
    plan: { lot: "0c" },
    migrated: true,
  },
  {
    // The dashboard still sends the bytes through its file route (progress,
    // same-origin); agents use the two procedures, or send the bytes or a
    // public URL in one call (uploadImage).
    id: "categories.uploadImage",
    sources: [
      route(ROUTE.files, "POST (kind=category)"),
      procedure("categories", "createImageUpload"),
      procedure("categories", "completeImageUpload"),
      procedure("categories", "uploadImage"),
    ],
    kind: "write",
    plan: { lot: "0c" },
    migrated: true,
  },
  {
    // The dashboard has no ordering screen yet; the API and agents have it.
    id: "categories.reorder",
    sources: [procedure("categories", "reorder")],
    kind: "write",
    plan: { lot: "0c" },
    migrated: true,
  },

  // --- Customers (4) ------------------------------------------------------
  {
    id: "customers.list",
    sources: [procedure("customers", "list"), tool(MCP.customers, "list_customers")],
    kind: "read",
    plan: { lot: "4" },
  },
  {
    id: "customers.get",
    sources: [tool(MCP.customers, "get_customer")],
    kind: "read",
    plan: { lot: "4" },
  },
  {
    id: "customers.create",
    sources: [action(SA.customers, "createCustomer"), tool(MCP.customers, "create_customer")],
    kind: "write",
    plan: { lot: "4" },
  },
  {
    id: "customers.update",
    sources: [action(SA.customers, "updateCustomer"), tool(MCP.customers, "update_customer")],
    kind: "write",
    plan: { lot: "4" },
  },
  {
    id: "customers.updateSection",
    sources: [action(SA.customers, "updateCustomerSection")],
    kind: "write",
    plan: { lot: "4" },
  },
  {
    id: "customers.updateNotes",
    sources: [action(SA.customers, "updateCustomerNotes")],
    kind: "write",
    plan: { lot: "4" },
  },
  {
    id: "customers.delete",
    sources: [action(SA.customers, "deleteCustomer")],
    kind: "write",
    sensitive: "destructive",
    plan: { lot: "4" },
  },
  {
    id: "customers.listFields",
    sources: [procedure("customerFields", "list")],
    kind: "read",
    plan: { lot: "4" },
  },
  {
    id: "customers.createField",
    sources: [procedure("customerFields", "create")],
    kind: "write",
    plan: { lot: "4" },
  },
  {
    id: "customers.adoptFieldTemplate",
    sources: [procedure("customerFields", "adoptTemplate")],
    kind: "write",
    plan: { lot: "4" },
  },
  {
    id: "customers.updateField",
    sources: [procedure("customerFields", "update")],
    kind: "write",
    plan: { lot: "4" },
  },
  {
    id: "customers.deleteField",
    sources: [procedure("customerFields", "remove")],
    kind: "write",
    sensitive: "destructive",
    plan: { lot: "4" },
  },
  {
    id: "customers.listFieldTargetOptions",
    sources: [procedure("customerFields", "targetOptions")],
    kind: "read",
    plan: { lot: "4" },
  },
  {
    id: "customers.listFieldsForProduct",
    sources: [procedure("customerFields", "forProduct")],
    kind: "read",
    plan: { lot: "4" },
  },
  {
    id: "customers.findFieldValueDuplicates",
    sources: [procedure("customerFields", "duplicates")],
    kind: "read",
    plan: { lot: "4" },
  },
  {
    id: "customers.getProfileSettings",
    sources: [procedure("customerFields", "profileSettings")],
    kind: "read",
    plan: { lot: "4" },
  },
  {
    id: "customers.updateProfileField",
    sources: [procedure("customerFields", "updateProfileField")],
    kind: "write",
    plan: { lot: "4" },
  },
  {
    id: "customers.getFormLayout",
    sources: [procedure("customerFields", "layout")],
    kind: "read",
    plan: { lot: "4" },
  },
  {
    id: "customers.updateFormLayout",
    sources: [procedure("customerFields", "updateLayout")],
    kind: "write",
    plan: { lot: "4" },
  },

  // --- Statistics and exports (5) ----------------------------------------
  {
    id: "analytics.getDashboardStats",
    sources: [procedure("analytics", "getDashboardStats")],
    kind: "read",
    plan: { lot: "5" },
    migrated: true,
  },
  {
    id: "analytics.getRevenueReport",
    sources: [procedure("analytics", "getRevenueReport")],
    kind: "read",
    plan: { lot: "5" },
    migrated: true,
  },
  {
    id: "analytics.getProductPerformance",
    sources: [procedure("analytics", "getProductPerformance")],
    kind: "read",
    plan: { lot: "5" },
    migrated: true,
  },
  {
    id: "analytics.export",
    sources: [route(ROUTE.export, "GET")],
    kind: "read",
    plan: { lot: "5" },
  },
  {
    id: "analytics.exportContracts",
    sources: [route(ROUTE.exportContracts, "GET")],
    kind: "read",
    plan: { lot: "5" },
  },

  // --- Store settings (6) -------------------------------------------------
  {
    id: "settings.get",
    sources: [procedure("settings", "get")],
    kind: "read",
    plan: { lot: "6" },
    migrated: true,
  },
  {
    id: "settings.updateStoreInfo",
    sources: [procedure("settings", "updateStoreInfo")],
    kind: "write",
    plan: { lot: "6" },
    migrated: true,
  },
  {
    // Sensitive when the country or the currency changes.
    id: "settings.updateCompany",
    sources: [procedure("settings", "updateCompany")],
    kind: "write",
    sensitive: "money",
    plan: { lot: "6" },
    migrated: true,
  },
  {
    id: "settings.updateLegal",
    sources: [procedure("settings", "updateLegal")],
    kind: "write",
    plan: { lot: "6" },
    migrated: true,
  },
  {
    // Sensitive when the booking mode or the share paid online changes.
    id: "settings.updateReservationRules",
    sources: [procedure("settings", "updateReservationRules")],
    kind: "write",
    sensitive: "money",
    plan: { lot: "6" },
    migrated: true,
  },
  {
    id: "settings.updateBusinessHours",
    sources: [procedure("settings", "updateBusinessHours")],
    kind: "write",
    plan: { lot: "6" },
    migrated: true,
  },
  {
    id: "settings.updateDelivery",
    sources: [procedure("settings", "updateDelivery")],
    kind: "write",
    sensitive: "money",
    plan: { lot: "6" },
    migrated: true,
  },
  {
    id: "settings.createLocation",
    sources: [procedure("settings", "createLocation")],
    kind: "write",
    plan: { lot: "6" },
    migrated: true,
  },
  {
    id: "settings.updateLocation",
    sources: [procedure("settings", "updateLocation")],
    kind: "write",
    plan: { lot: "6" },
    migrated: true,
  },
  {
    id: "settings.setLocationActive",
    sources: [procedure("settings", "setLocationActive")],
    kind: "write",
    plan: { lot: "6" },
    migrated: true,
  },
  {
    id: "settings.updateTaxes",
    sources: [procedure("settings", "updateTaxes")],
    kind: "write",
    sensitive: "money",
    plan: { lot: "6" },
    migrated: true,
  },
  {
    id: "settings.updateInspections",
    sources: [action(SA.inspectionSettings, "updateInspectionSettings")],
    kind: "write",
    plan: { lot: "6" },
  },
  {
    id: "settings.getLegalProfile",
    sources: [procedure("settings", "getLegalProfile")],
    kind: "read",
    plan: { lot: "6" },
    migrated: true,
  },
  {
    // The identity saves directly; the electronic invoicing switches ask a confirmation.
    id: "settings.upsertLegalProfile",
    sources: [procedure("settings", "upsertLegalProfile")],
    kind: "write",
    sensitive: "money",
    plan: { lot: "6" },
    migrated: true,
  },
  {
    // The checkout's company field keeps its own server action, for renters.
    id: "settings.searchCompanyRegistry",
    sources: [procedure("settings", "searchCompanyRegistry")],
    kind: "read",
    plan: { lot: "6" },
    migrated: true,
  },
  {
    id: "settings.resetInvoicingSetup",
    sources: [action(SA.invoicing, "resetInvoicingSetupForDev")],
    kind: "write",
    sensitive: "destructive",
    plan: { exclude: "Development-only reset of the invoicing setup, refused in production" },
  },
  {
    id: "settings.getNotifications",
    sources: [action(SA.notifications, "getNotificationSettings")],
    kind: "read",
    plan: { lot: "6" },
  },
  {
    id: "settings.updateNotificationPreference",
    sources: [procedure("notifications", "updateSinglePreference")],
    kind: "write",
    plan: { lot: "6" },
  },
  {
    id: "settings.updateCustomerNotificationPreference",
    sources: [procedure("notifications", "updateCustomerPreference")],
    kind: "write",
    plan: { lot: "6" },
  },
  {
    id: "settings.updateCustomerReminders",
    sources: [procedure("notifications", "updateReminderSettings")],
    kind: "write",
    plan: { lot: "6" },
  },
  {
    id: "settings.updateOwnerReminders",
    sources: [procedure("notifications", "updateAdminReminderSettings")],
    kind: "write",
    plan: { lot: "6" },
  },
  {
    id: "settings.updateDiscordWebhook",
    sources: [action(SA.notifications, "updateDiscordWebhook")],
    kind: "write",
    plan: { lot: "6" },
  },
  {
    id: "settings.testDiscordWebhook",
    sources: [action(SA.notifications, "testDiscordWebhook")],
    kind: "write",
    plan: { lot: "6" },
  },
  {
    id: "settings.updateOwnerPhone",
    sources: [action(SA.notifications, "updateOwnerPhone")],
    kind: "write",
    plan: { lot: "6" },
  },
  {
    id: "ui.subscribePush",
    sources: [procedure("notifications", "subscribe")],
    kind: "write",
    plan: { exclude: "Browser push subscription of the current device" },
  },
  {
    id: "ui.unsubscribePush",
    sources: [procedure("notifications", "unsubscribe")],
    kind: "write",
    plan: { exclude: "Browser push subscription of the current device" },
  },
  {
    id: "ui.listPushSubscriptions",
    sources: [procedure("notifications", "list")],
    kind: "read",
    plan: { exclude: "Browser push subscription of the current device" },
  },
  {
    id: "settings.createPromoCode",
    sources: [action(SA.promoCodes, "createPromoCode")],
    kind: "write",
    plan: { lot: "6" },
  },
  {
    id: "settings.updatePromoCode",
    sources: [action(SA.promoCodes, "updatePromoCode")],
    kind: "write",
    plan: { lot: "6" },
  },
  {
    id: "settings.togglePromoCode",
    sources: [action(SA.promoCodes, "togglePromoCode")],
    kind: "write",
    plan: { lot: "6" },
  },
  {
    id: "settings.deletePromoCode",
    sources: [action(SA.promoCodes, "deletePromoCode")],
    kind: "write",
    sensitive: "destructive",
    plan: { lot: "6" },
  },
  {
    id: "settings.updateReviewBooster",
    sources: [action(SA.reviewBooster, "updateReviewBoosterSettings")],
    kind: "write",
    plan: { lot: "6" },
  },
  {
    id: "settings.searchGooglePlaces",
    sources: [action(SA.reviewBooster, "searchGooglePlaces")],
    kind: "read",
    plan: { lot: "6" },
  },
  {
    id: "settings.getGooglePlaceDetails",
    sources: [action(SA.reviewBooster, "fetchGooglePlaceDetails")],
    kind: "read",
    plan: { lot: "6" },
  },
  {
    id: "settings.getReviewBoosterTemplate",
    sources: [action(SA.reviewBooster, "getReviewBoosterTemplate")],
    kind: "read",
    plan: { lot: "6" },
  },
  {
    id: "settings.updateReviewBoosterTemplate",
    sources: [action(SA.reviewBooster, "updateReviewBoosterTemplate")],
    kind: "write",
    plan: { lot: "6" },
  },
  {
    id: "settings.updatePlatformAdmin",
    sources: [action(SA.admin, "updateAdminSettings")],
    kind: "write",
    plan: { lot: "6" },
    actors: ["session"],
  },
  {
    id: "online_store.update",
    sources: [procedure("onlineStore", "update")],
    kind: "write",
    plan: { lot: "6" },
    migrated: true,
  },
  {
    // The onboarding's branding step saves through it too.
    id: "online_store.updateAppearance",
    sources: [procedure("onlineStore", "updateAppearance")],
    kind: "write",
    plan: { lot: "6" },
    migrated: true,
  },
  {
    // The dashboard keeps its upload route, which streams with progress.
    // Agents also send the bytes or a public URL in one call (uploadImage).
    id: "online_store.uploadImage",
    sources: [
      route(ROUTE.files, "POST (kind=logo)"),
      route(ROUTE.files, "POST (kind=hero)"),
      procedure("onlineStore", "createImageUpload"),
      procedure("onlineStore", "completeImageUpload"),
      procedure("onlineStore", "uploadImage"),
    ],
    kind: "write",
    plan: { lot: "6" },
    migrated: true,
  },
  {
    id: "online_store.checkSlugAvailability",
    sources: [procedure("onlineStore", "checkSlugAvailability")],
    kind: "read",
    plan: { lot: "6" },
    migrated: true,
  },
  {
    // The public URL changes and old links break: confirmed with a preview.
    id: "online_store.updateSlug",
    sources: [procedure("onlineStore", "updateSlug")],
    kind: "write",
    sensitive: "destructive",
    plan: { lot: "6" },
    migrated: true,
  },
  {
    id: "online_store.getMarketplaceChannel",
    sources: [action(SA.marketplace, "getMarketplaceChannelState")],
    kind: "read",
    plan: { lot: "6" },
  },
  {
    id: "online_store.enableMarketplaceChannel",
    sources: [action(SA.marketplace, "enableMarketplaceChannel")],
    kind: "write",
    plan: { lot: "6" },
  },
  {
    id: "online_store.disableMarketplaceChannel",
    sources: [action(SA.marketplace, "disableMarketplaceChannel")],
    kind: "write",
    plan: { lot: "6" },
  },
  {
    id: "online_store.confirmDirectoryClaim",
    sources: [action(SA.marketplace, "confirmDirectoryClaim")],
    kind: "write",
    plan: { lot: "6" },
  },
  {
    id: "online_store.dismissDirectoryClaim",
    sources: [action(SA.marketplace, "dismissDirectoryClaim")],
    kind: "write",
    plan: { lot: "6" },
  },
  {
    // The dashboard keeps its direct flow (the action redirects to Stripe);
    // an agent gets a handoff link to the same service.
    id: "payments.startStripeOnboarding",
    sources: [
      action(SA.payments, "startStripeOnboarding"),
      procedure("payments", "startStripeOnboarding"),
    ],
    kind: "write",
    plan: { handoff: "stripe", lot: "6" },
  },
  {
    // Stripe's return: the dashboard's callback page and the handoff's return route.
    id: "payments.completeStripeOnboarding",
    sources: [route(ROUTE.handoffReturn, "GET")],
    kind: "write",
    plan: { handoff: "stripe", lot: "6" },
  },
  {
    id: "payments.syncStripeStatus",
    sources: [procedure("payments", "syncStripeStatus")],
    kind: "write",
    plan: { lot: "6" },
    migrated: true,
  },
  {
    // The dashboard opens Stripe in a new tab; an agent gets a handoff link.
    id: "payments.getStripeDashboardUrl",
    sources: [
      action(SA.payments, "getStripeDashboardUrl"),
      procedure("payments", "openStripeDashboard"),
    ],
    kind: "write",
    plan: { handoff: "stripe", lot: "6" },
  },
  {
    id: "payments.disconnectStripe",
    sources: [action(SA.payments, "disconnectStripe")],
    kind: "write",
    sensitive: "destructive",
    plan: { lot: "6" },
  },

  // --- Integrations, purchase invoices, SMS, AI (7) -----------------------
  {
    id: "integrations.listCatalog",
    sources: [
      action(SA.integrations, "listIntegrationsCatalogAction"),
      procedure("integrations", "listCatalog"),
    ],
    kind: "read",
    plan: { lot: "7" },
  },
  {
    id: "integrations.listCategory",
    sources: [
      action(SA.integrations, "listIntegrationsCategoryAction"),
      procedure("integrations", "listCategory"),
    ],
    kind: "read",
    plan: { lot: "7" },
  },
  {
    id: "integrations.getDetail",
    sources: [
      action(SA.integrations, "getIntegrationDetailAction"),
      procedure("integrations", "getDetail"),
    ],
    kind: "read",
    plan: { lot: "7" },
  },
  {
    id: "integrations.setEnabled",
    sources: [
      action(SA.integrations, "setIntegrationEnabledAction"),
      procedure("integrations", "setEnabled"),
    ],
    kind: "write",
    plan: { lot: "7" },
  },
  {
    id: "integrations.getCalendarState",
    sources: [
      action(SA.integrations, "getCalendarIntegrationStateAction"),
      procedure("integrations", "getCalendarState"),
    ],
    kind: "read",
    plan: { lot: "7" },
  },
  {
    id: "integrations.connectGoogleCalendar",
    sources: [route(ROUTE.googleCalendarStart, "GET")],
    kind: "write",
    plan: { handoff: "google-oauth", lot: "7" },
  },
  {
    id: "integrations.updateGoogleCalendarSettings",
    sources: [
      action(SA.integrations, "updateGoogleCalendarSettingsAction"),
      procedure("integrations", "updateGoogleCalendarSettings"),
    ],
    kind: "write",
    plan: { lot: "7" },
  },
  {
    id: "integrations.resyncGoogleCalendar",
    sources: [
      action(SA.integrations, "resyncGoogleCalendarAction"),
      procedure("integrations", "resyncGoogleCalendar"),
    ],
    kind: "write",
    plan: { lot: "7" },
  },
  {
    id: "integrations.disconnectGoogleCalendar",
    sources: [
      action(SA.integrations, "disconnectGoogleCalendarAction"),
      procedure("integrations", "disconnectGoogleCalendar"),
    ],
    kind: "write",
    sensitive: "destructive",
    plan: { lot: "7" },
  },
  {
    id: "integrations.getTulipState",
    sources: [
      action(SA.integrations, "getTulipIntegrationStateAction"),
      procedure("integrations", "getTulipState"),
    ],
    kind: "read",
    plan: { lot: "7" },
  },
  {
    id: "integrations.getTulipProductState",
    sources: [
      action(SA.integrations, "getTulipProductStateAction"),
      procedure("integrations", "getTulipProductState"),
    ],
    kind: "read",
    plan: { lot: "7" },
  },
  {
    id: "integrations.connectTulip",
    sources: [
      action(SA.integrations, "connectTulipApiKeyAction"),
      procedure("integrations", "connectTulip"),
    ],
    kind: "write",
    plan: { lot: "7" },
  },
  {
    id: "integrations.updateTulipConfiguration",
    sources: [
      action(SA.integrations, "updateTulipConfigurationAction"),
      procedure("integrations", "updateTulipConfiguration"),
    ],
    kind: "write",
    plan: { lot: "7" },
  },
  {
    id: "integrations.upsertTulipProductMapping",
    sources: [
      action(SA.integrations, "upsertTulipProductMappingAction"),
      procedure("integrations", "upsertTulipProductMapping"),
    ],
    kind: "write",
    plan: { lot: "7" },
  },
  {
    id: "integrations.pushTulipProductUpdate",
    sources: [
      action(SA.integrations, "pushTulipProductUpdateAction"),
      procedure("integrations", "pushTulipProductUpdate"),
    ],
    kind: "write",
    plan: { lot: "7" },
  },
  {
    id: "integrations.createTulipProduct",
    sources: [
      action(SA.integrations, "createTulipProductAction"),
      procedure("integrations", "createTulipProduct"),
    ],
    kind: "write",
    plan: { lot: "7" },
  },
  {
    id: "integrations.disconnectTulip",
    sources: [
      action(SA.integrations, "disconnectTulipAction"),
      procedure("integrations", "disconnectTulip"),
    ],
    kind: "write",
    sensitive: "destructive",
    plan: { lot: "7" },
  },
  {
    id: "integrations.getCalendarSyncState",
    sources: [action(SA.calendar, "getCalendarSyncState")],
    kind: "read",
    plan: { lot: "7" },
  },
  {
    id: "integrations.getIcsToken",
    sources: [action(SA.calendar, "getIcsToken")],
    kind: "read",
    plan: { lot: "7" },
  },
  {
    id: "integrations.generateIcsToken",
    sources: [action(SA.calendar, "generateIcsToken")],
    kind: "write",
    plan: { lot: "7" },
  },
  {
    id: "integrations.regenerateIcsToken",
    sources: [action(SA.calendar, "regenerateIcsToken")],
    kind: "write",
    plan: { lot: "7" },
  },
  {
    id: "integrations.connectSuperPdp",
    sources: [route(ROUTE.superPdpStart, "GET")],
    kind: "write",
    plan: { handoff: "superpdp", lot: "7" },
  },
  {
    id: "purchase_invoices.getDocument",
    sources: [route(ROUTE.purchaseInvoice, "GET")],
    kind: "read",
    plan: { lot: "7" },
  },
  {
    id: "purchase_invoices.sync",
    sources: [action(SA.purchaseInvoices, "syncPurchaseInvoices")],
    kind: "write",
    plan: { lot: "7" },
  },
  {
    id: "purchase_invoices.acknowledge",
    sources: [action(SA.purchaseInvoices, "acknowledgePurchaseInvoice")],
    kind: "write",
    plan: { lot: "7" },
  },
  {
    id: "purchase_invoices.accept",
    sources: [action(SA.purchaseInvoices, "acceptPurchaseInvoice")],
    kind: "write",
    plan: { lot: "7" },
  },
  {
    id: "purchase_invoices.refuse",
    sources: [action(SA.purchaseInvoices, "refusePurchaseInvoice")],
    kind: "write",
    plan: { lot: "7" },
  },
  {
    id: "sms.listLogs",
    sources: [action(SA.sms, "getSmsLogs")],
    kind: "read",
    plan: { lot: "7" },
  },
  {
    id: "sms.getMonthStats",
    sources: [action(SA.sms, "getSmsMonthStats")],
    kind: "read",
    plan: { lot: "7" },
  },
  {
    id: "sms.listAvailableMonths",
    sources: [action(SA.sms, "getAvailableMonths")],
    kind: "read",
    plan: { lot: "7" },
  },
  {
    id: "sms.getTopupPrice",
    sources: [action(SA.sms, "getTopupPriceInfo")],
    kind: "read",
    plan: { lot: "7" },
  },
  {
    id: "sms.listTopups",
    sources: [action(SA.sms, "getTopupHistory")],
    kind: "read",
    plan: { lot: "7" },
  },
  {
    id: "sms.createTopupCheckout",
    sources: [action(SA.sms, "createTopupCheckout")],
    kind: "write",
    sensitive: "money",
    plan: { handoff: "stripe", lot: "7" },
  },
  {
    id: "ai.updateAdvisorSettings",
    sources: [action(SA.aiAdvisor, "updateAiAdvisorSettings")],
    kind: "write",
    plan: { lot: "7" },
  },
  {
    id: "ai.listAdvisorConversations",
    sources: [procedure("aiAdvisor", "listConversations")],
    kind: "read",
    plan: { lot: "7" },
  },
  {
    id: "ai.getAdvisorConversation",
    sources: [procedure("aiAdvisor", "getConversation")],
    kind: "read",
    plan: { lot: "7" },
  },
  {
    id: "ai.getAdvisorConversationByReservation",
    sources: [procedure("aiAdvisor", "getByReservation")],
    kind: "read",
    plan: { lot: "7" },
  },
  {
    id: "ai.getCreditsBalance",
    sources: [route(ROUTE.aiCredits, "GET")],
    kind: "read",
    plan: { lot: "7" },
  },
  {
    id: "ai.createCreditTopupCheckout",
    sources: [action(SA.aiCredits, "createAiCreditTopupCheckout")],
    kind: "write",
    sensitive: "money",
    plan: { handoff: "stripe", lot: "7" },
  },
  {
    id: "ai.updateCreditsAutoTopup",
    sources: [action(SA.aiCredits, "updateAiCreditsAutoTopup")],
    kind: "write",
    sensitive: "money",
    plan: { lot: "7" },
  },
  {
    id: "ai.listChats",
    sources: [action(SA.aiChat, "listChats")],
    kind: "read",
    plan: { lot: "7" },
  },
  {
    id: "ai.getChatMessages",
    sources: [action(SA.aiChat, "loadChatMessages")],
    kind: "read",
    plan: { lot: "7" },
  },
  {
    id: "ai.chat",
    sources: [route(ROUTE.aiChat, "POST")],
    kind: "write",
    sensitive: "spend",
    plan: { lot: "7" },
  },
  {
    id: "ai.updatePhoneSettings",
    sources: [action(SA.aiPhone, "updateAiPhoneSettings")],
    kind: "write",
    plan: { lot: "7" },
  },
  {
    id: "ai.previewVoice",
    sources: [route(ROUTE.voicePreview, "GET")],
    kind: "read",
    plan: { lot: "7" },
  },
  {
    id: "ai.getCallRecording",
    sources: [route(ROUTE.voiceRecording, "GET")],
    kind: "read",
    plan: { lot: "7" },
  },
  {
    id: "ai.searchVoiceNumbers",
    sources: [action(SA.voice, "searchVoiceNumbers")],
    kind: "read",
    plan: { lot: "7" },
  },
  {
    id: "ai.provisionVoiceNumber",
    sources: [action(SA.voice, "provisionVoiceNumber")],
    kind: "write",
    sensitive: "spend",
    plan: { lot: "7" },
  },
  {
    id: "ai.linkVoiceNumber",
    sources: [action(SA.voice, "linkVoiceNumber")],
    kind: "write",
    plan: { lot: "7" },
  },
  {
    id: "ai.releaseVoiceNumber",
    sources: [action(SA.voice, "releaseVoiceNumber")],
    kind: "write",
    sensitive: "destructive",
    plan: { lot: "7" },
  },

  // --- Team, subscription, store creation (8) -----------------------------
  {
    // The team page's two lists; an agent reads them too.
    id: "team.listMembers",
    sources: [procedure("team", "listMembers")],
    kind: "read",
    plan: { lot: "8" },
    migrated: true,
  },
  {
    id: "team.listInvitations",
    sources: [procedure("team", "listInvitations")],
    kind: "read",
    plan: { lot: "8" },
    migrated: true,
  },
  {
    // Always as a member, never an owner (Téo's decision, 2026-11-09). An
    // agent's invitation creates nothing until an owner approves it from a
    // link (handoffs.decide). No procedure changes a role.
    id: "team.inviteMember",
    sources: [procedure("team", "invite")],
    kind: "write",
    sensitive: "send",
    plan: { lot: "8" },
    migrated: true,
  },
  {
    // The new link is the invitation's credential: the dashboard only.
    id: "team.resendInvitation",
    sources: [procedure("team", "resendInvitation")],
    kind: "write",
    sensitive: "send",
    plan: { lot: "8" },
    actors: ["session"],
  },
  {
    // The link the dashboard copies on an instance that sends no e-mail.
    id: "team.getInvitationLink",
    sources: [procedure("team", "invitationLink")],
    kind: "read",
    plan: { lot: "8" },
    actors: ["session"],
  },
  {
    id: "team.cancelInvitation",
    sources: [procedure("team", "cancelInvitation")],
    kind: "write",
    sensitive: "destructive",
    plan: { lot: "8" },
    migrated: true,
  },
  {
    id: "team.removeMember",
    sources: [procedure("team", "removeMember")],
    kind: "write",
    sensitive: "destructive",
    plan: { lot: "8" },
    migrated: true,
  },
  {
    // Joining a store grants the caller a role: never done by an agent.
    id: "team.acceptInvitation",
    sources: [procedure("team", "acceptInvitation")],
    kind: "write",
    plan: { lot: "8" },
    actors: ["session"],
  },
  {
    id: "billing.saveDetails",
    sources: [action(SA.billing, "saveBillingDetailsAction")],
    kind: "write",
    plan: { lot: "8" },
  },
  {
    // What the billing pages show, read-only.
    id: "billing.getStatus",
    sources: [procedure("billing", "getStatus")],
    kind: "read",
    plan: { lot: "6" },
    migrated: true,
  },
  {
    // The dashboard keeps its direct flow (the action redirects to Checkout);
    // an agent gets a handoff link to the same billing service call.
    id: "billing.startCardSetup",
    sources: [action(SA.billing, "startBillingCardSetup"), procedure("billing", "startCardSetup")],
    kind: "write",
    plan: { handoff: "stripe", lot: "6" },
  },
  {
    id: "billing.createCheckout",
    sources: [action(SA.subscription, "createCheckoutSession")],
    kind: "write",
    sensitive: "money",
    plan: { handoff: "stripe", lot: "8" },
  },
  {
    id: "billing.previewPlanChange",
    sources: [action(SA.subscription, "previewPlanChange")],
    kind: "read",
    plan: { lot: "8" },
  },
  {
    id: "billing.changePlan",
    sources: [action(SA.subscription, "changeSubscriptionPlan")],
    kind: "write",
    sensitive: "money",
    plan: { lot: "8" },
  },
  {
    id: "billing.keepCurrentPlan",
    sources: [action(SA.subscription, "keepCurrentPlan")],
    kind: "write",
    plan: { lot: "8" },
  },
  {
    id: "billing.switchToPayAsYouGo",
    sources: [action(SA.subscription, "switchToPayAsYouGo")],
    kind: "write",
    sensitive: "money",
    plan: { lot: "8" },
  },
  {
    id: "billing.reactivateSubscription",
    sources: [action(SA.subscription, "reactivateSubscription")],
    kind: "write",
    sensitive: "money",
    plan: { lot: "8" },
  },
  {
    id: "billing.cancelSubscription",
    sources: [action(SA.subscription, "cancelSubscription")],
    kind: "write",
    sensitive: "destructive",
    plan: { handoff: "stripe", lot: "8" },
  },
  {
    id: "billing.openCustomerPortal",
    sources: [action(SA.subscription, "openCustomerPortal")],
    kind: "read",
    plan: { handoff: "stripe", lot: "8" },
  },
  {
    id: "billing.openBillingPortal",
    sources: [action(SA.subscription, "openBillingPortal")],
    kind: "read",
    plan: { handoff: "stripe", lot: "8" },
  },
  {
    id: "billing.getReferralData",
    sources: [action(SA.referrals, "getReferralData")],
    kind: "read",
    plan: { lot: "8" },
  },
  {
    id: "billing.getReferralRewardSummary",
    sources: [
      action(SA.referrals, "getReferralRewardSummary"),
      procedure("referral", "getRewardSummary"),
    ],
    kind: "read",
    plan: { lot: "8" },
  },
  {
    id: "stores.list",
    sources: [procedure("stores", "list")],
    kind: "read",
    plan: { lot: "1" },
    migrated: true,
  },
  {
    // The onboarding's store step creates the store through this procedure;
    // an agent connected over all the user's stores does too.
    id: "stores.create",
    sources: [procedure("stores", "create")],
    kind: "write",
    sensitive: "money",
    plan: { lot: "8" },
    migrated: true,
  },
  {
    id: "stores.checkSlugAvailability",
    sources: [procedure("stores", "checkSlugAvailability")],
    kind: "read",
    plan: { lot: "8" },
    migrated: true,
  },
  {
    // The onboarding's store step on a store that exists already: an
    // incomplete store of the user (an agent's included), or the one being
    // edited. The wizard's own step: a session only, agents set the same
    // fields through the settings procedures.
    id: "stores.updateOnboardingInfo",
    sources: [procedure("stores", "updateOnboardingInfo")],
    kind: "write",
    plan: { lot: "8" },
    actors: ["session"],
  },
  {
    id: "stores.getOnboardingDraft",
    sources: [procedure("onboarding", "getDraft")],
    kind: "read",
    plan: { lot: "8" },
  },
  {
    // What a store still lacks before it goes live; the dashboard's home
    // checklist reads it too.
    id: "stores.getLaunchChecklist",
    sources: [procedure("stores", "getLaunchChecklist")],
    kind: "read",
    plan: { lot: "8" },
    migrated: true,
  },
  {
    // The onboarding's last step and an agent's go-live (stores_go_live).
    id: "stores.completeOnboarding",
    sources: [procedure("stores", "completeOnboarding")],
    kind: "write",
    sensitive: "money",
    plan: { lot: "8" },
    migrated: true,
  },
  {
    // Who a connection acts for: ChatGPT's profile tool (account_get_profile).
    id: "account.getProfile",
    sources: [procedure("account", "getProfile")],
    kind: "read",
    plan: { lot: "1" },
    migrated: true,
  },
  {
    id: "account.updateInfo",
    sources: [action(SA.account, "updateAccountInfo")],
    kind: "write",
    plan: { lot: "8" },
  },
  {
    id: "account.updateProfile",
    sources: [action(SA.onboardingProfile, "updateUserProfile")],
    kind: "write",
    plan: { lot: "8" },
  },
  {
    id: "account.saveAcquisitionChannel",
    sources: [action(SA.onboardingProfile, "saveAcquisitionChannel")],
    kind: "write",
    plan: { lot: "8" },
  },
  {
    id: "account.uploadAvatar",
    sources: [route(ROUTE.files, "POST (kind=avatar)")],
    kind: "write",
    plan: { lot: "8" },
  },

  // --- API keys and agent connections (1) ---------------------------------
  {
    id: "settings.listApiKeys",
    sources: [procedure("apiKeys", "list")],
    kind: "read",
    plan: { lot: "1" },
  },
  {
    id: "settings.createApiKey",
    sources: [procedure("apiKeys", "create")],
    kind: "write",
    plan: { lot: "1" },
    actors: ["session"],
  },
  {
    id: "settings.revokeApiKey",
    sources: [procedure("apiKeys", "revoke")],
    kind: "write",
    sensitive: "destructive",
    plan: { lot: "1" },
    actors: ["session"],
  },
  {
    id: "settings.updateApiKeyConfirmation",
    sources: [procedure("apiKeys", "updateConfirmation")],
    kind: "write",
    plan: { lot: "1" },
    actors: ["session"],
  },
  {
    // The consent page: what is asked, then the answer. A session only: the
    // agent waiting for the code never grants itself anything.
    id: "account.authorizeAgentConnection",
    sources: [
      procedure("agentConnections", "getAuthorization"),
      procedure("agentConnections", "authorize"),
    ],
    kind: "write",
    plan: { lot: "1" },
    actors: ["session"],
  },
  {
    id: "account.listAgentConnections",
    sources: [procedure("agentConnections", "list")],
    kind: "read",
    plan: { lot: "1" },
  },
  {
    id: "account.revokeAgentConnection",
    sources: [procedure("agentConnections", "revoke")],
    kind: "write",
    sensitive: "destructive",
    plan: { lot: "1" },
    actors: ["session"],
  },
  {
    id: "account.updateAgentConnection",
    sources: [procedure("agentConnections", "update")],
    kind: "write",
    plan: { lot: "1" },
    actors: ["session"],
  },

  // --- Excluded: interface preferences, password and passkeys -------------
  {
    id: "ui.updateKeyboardShortcuts",
    sources: [action(SA.account, "updateKeyboardShortcuts")],
    kind: "write",
    plan: { exclude: UI_ONLY },
  },
  {
    id: "ui.dismissNotice",
    sources: [procedure("account", "dismissNotice")],
    kind: "write",
    plan: { exclude: UI_ONLY },
    actors: ["session"],
  },
  {
    id: "ui.acknowledgeReeentIntro",
    sources: [action(SA.reeent, "acknowledgeReeentIntro")],
    kind: "write",
    plan: { exclude: UI_ONLY },
  },
  {
    id: "ui.markWhatsNewSeen",
    sources: [action(SA.whatsNew, "markWhatsNewAnnouncementsSeen")],
    kind: "write",
    plan: { exclude: UI_ONLY },
  },
  {
    id: "ui.dismissWhatsNewFeature",
    sources: [action(SA.whatsNew, "dismissWhatsNewFeature")],
    kind: "write",
    plan: { exclude: UI_ONLY },
  },
  {
    id: "ui.switchStore",
    sources: [action(SA.dashboard, "switchStore"), action(SA.multiStore, "setCurrentStoreAction")],
    kind: "write",
    plan: { exclude: "Current-store cookie; API callers name the store on each call" },
  },
  {
    id: "account.setPassword",
    sources: [action(SA.password, "setPassword")],
    kind: "write",
    plan: { exclude: PASSWORD },
  },
  {
    id: "account.removePassword",
    sources: [action(SA.password, "removePassword")],
    kind: "write",
    plan: { exclude: PASSWORD },
  },
  {
    id: "account.revokePasswordAccess",
    sources: [action(SA.passwordAlert, "revokePasswordAccessAction")],
    kind: "write",
    plan: { exclude: PASSWORD },
  },
] as const satisfies readonly Capability[];

export type CapabilityId = (typeof capabilities)[number]["id"];

const STOREFRONT = "Storefront customer action; the storefront router stays as it is";

/** `"use server"` modules outside the dashboard: customer-facing, not store-user capabilities. */
export const outOfScopeServerModules = [
  { path: "apps/web/app/(storefront)/[slug]/account/actions.ts", reason: STOREFRONT },
  { path: "apps/web/app/(storefront)/[slug]/account/communication-actions.ts", reason: STOREFRONT },
  { path: "apps/web/app/(storefront)/[slug]/account/profile-actions.ts", reason: STOREFRONT },
  {
    path: "apps/web/app/(storefront)/[slug]/account/reservations/[reservationId]/actions.ts",
    reason: STOREFRONT,
  },
  {
    path: "apps/web/app/(storefront)/[slug]/account/reservations/[reservationId]/date-change-actions.ts",
    reason: STOREFRONT,
  },
  {
    path: "apps/web/app/(storefront)/[slug]/account/reservations/[reservationId]/extension-actions.ts",
    reason: STOREFRONT,
  },
  {
    path: "apps/web/app/(storefront)/[slug]/authorize-deposit/[reservationId]/actions.ts",
    reason: STOREFRONT,
  },
  { path: "apps/web/app/(storefront)/[slug]/catalog/actions.ts", reason: STOREFRONT },
  { path: "apps/web/app/(storefront)/[slug]/checkout/actions.ts", reason: STOREFRONT },
  { path: "apps/web/app/(storefront)/[slug]/checkout/cancelled/actions.ts", reason: STOREFRONT },
  { path: "apps/web/app/(storefront)/[slug]/contact/actions.ts", reason: STOREFRONT },
  { path: "apps/web/app/(storefront)/[slug]/pay/[reservationId]/actions.ts", reason: STOREFRONT },
] as const satisfies readonly OutOfScopeServerModule[];
