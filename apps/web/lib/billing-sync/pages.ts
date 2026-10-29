import { z } from "zod";

import {
  type BillingClientOptions,
  callBillingService,
  describeCall,
  readProblemCode,
  readSignedJson,
} from "@/lib/billing-sync/client";
import { log } from "@/lib/evlog";

// The billing pages' reads and writes, from the billing service (louez-billing
// docs/api, README §10): the overview, the statements, the billing details and the
// card's Checkout, for one store. Louez decides who sees them (lib/billing/billing-access.ts);
// the service answers for the store in the path.

const period = z.string().regex(/^[0-9]{4}-[0-9]{2}$/);

const savedCardSchema = z.object({
  brand: z.string().nullable(),
  last4: z.string().nullable(),
  expMonth: z.number().int().nullable(),
  expYear: z.number().int().nullable(),
  expired: z.boolean(),
});
export type BillingSavedCard = z.infer<typeof savedCardSchema>;

const overviewSchema = z.object({
  timeZone: z.string(),
  card: z.enum(["saved", "missing", "unknown", "not_needed", "in_louez"]),
  savedCard: savedCardSchema.nullable(),
  month: z
    .object({
      period,
      currencies: z.array(
        z.object({ currency: z.string(), atSourceMinor: z.number(), dueMinor: z.number() }),
      ),
      statementAt: z.string(),
    })
    .nullable(),
  cardSetupUnavailable: z.enum(["off", "in_louez"]).nullable(),
});
export type BillingOverviewView = z.infer<typeof overviewSchema>;

const statementSummarySchema = z.object({
  id: z.string(),
  period,
  currency: z.string(),
  status: z.literal("open"),
  owedMinor: z.number(),
  atSourceMinor: z.number(),
  dueMinor: z.number(),
});
export type BillingStatementSummary = z.infer<typeof statementSummarySchema>;

const statementsSchema = z.object({
  timeZone: z.string(),
  legacy: z.object({ until: z.string().nullable() }).nullable(),
  statements: z.array(statementSummarySchema),
});
export type BillingStatementsView = z.infer<typeof statementsSchema>;

export const STATEMENT_LINE_KINDS = [
  "pay",
  "refund",
  "dispute_open",
  "dispute_close",
  "uncollected",
  "rental",
  "mkt",
  "fee",
  "feerefund",
] as const;

export const STATEMENT_GROUPS = [
  "commission",
  "unpaid",
  "reservations",
  "marketplace",
  "atSource",
] as const;

const statementSchema = statementSummarySchema.extend({
  groups: z.array(
    z.object({
      group: z.enum(STATEMENT_GROUPS),
      totalMinor: z.number(),
      lines: z.array(
        z.object({
          key: z.string(),
          kind: z.enum(STATEMENT_LINE_KINDS),
          reservationNumber: z.string().nullable(),
          adjustsPeriod: period.nullable(),
          amountMinor: z.number(),
        }),
      ),
    }),
  ),
});
export type BillingStatementView = z.infer<typeof statementSchema>;

export const VAT_CHECKS = ["pending", "verified", "unverified", "unavailable", "unknown"] as const;

const detailsSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("ready"),
    legalName: z.string(),
    email: z.string(),
    address: z.object({
      line1: z.string(),
      line2: z.string(),
      postalCode: z.string(),
      city: z.string(),
      state: z.string(),
      country: z.string(),
    }),
    vat: z.object({ number: z.string(), check: z.enum(VAT_CHECKS) }).nullable(),
    storeCountry: z.string().nullable(),
  }),
  z.object({ kind: z.literal("no_customer") }),
  z.object({ kind: z.literal("unavailable") }),
]);
export type BillingDetailsView = z.infer<typeof detailsSchema>;

/** The form the owner fills in: every field a string, "" when left empty. */
export const BILLING_DETAILS_FIELDS = [
  "legalName",
  "email",
  "line1",
  "line2",
  "postalCode",
  "city",
  "state",
  "country",
  "vatNumber",
] as const;
export type BillingDetailsField = (typeof BILLING_DETAILS_FIELDS)[number];
export type BillingDetailsForm = Record<BillingDetailsField, string>;

const fieldErrorsSchema = z.object({
  errors: z.array(z.object({ path: z.string() })).nullable(),
});

/**
 * Why a call gave nothing usable: the store's snapshot has not reached the service yet
 * (`store_unknown`), no such statement or card setup (`not_found`), the store cannot
 * do this now or Stripe is down (`unavailable`), fields refused (`invalid`), or anything
 * else, logged (`failed`).
 */
export type BillingPageFailure =
  | { readonly reason: "store_unknown" | "not_found" | "unavailable" | "failed" }
  | { readonly reason: "invalid"; readonly fields: readonly BillingDetailsField[] };

export type BillingPageResult<T> =
  | { readonly ok: true; readonly value: T }
  | ({ readonly ok: false } & BillingPageFailure);

async function callPage<T>(
  request: { readonly method: "GET" | "POST"; readonly path: string; readonly query?: string },
  schema: z.ZodType<T>,
  body: unknown,
  options: BillingClientOptions,
): Promise<BillingPageResult<T>> {
  const label = `${request.method} /stores/…/billing${request.path}`;
  const response = await callBillingService(
    {
      endpoint: "pages",
      method: request.method,
      path: request.path,
      query: request.query,
      json: request.method === "POST" ? JSON.stringify(body ?? {}) : undefined,
    },
    options,
  );
  if (response.kind === "response" && response.signature.ok) {
    if (response.status === 200) {
      const read = readSignedJson(response, schema);
      if (read.ok) return { ok: true, value: read.value };
      log.error("billing", `${label}: ${read.reason}`);
      return { ok: false, reason: "failed" };
    }
    const code = readProblemCode(response);
    if (code === "store_unknown" || code === "not_found" || code === "unavailable") {
      return { ok: false, reason: code };
    }
    if (response.status === 400 && code === "invalid_request") {
      const fields = refusedFields(response.body);
      if (fields.length > 0) return { ok: false, reason: "invalid", fields };
    }
  }
  log.error("billing", `${label} failed: ${describeCall(response)}`);
  return { ok: false, reason: "failed" };
}

/** The form fields a refusal names, from its JSON Pointers such as `/email`. */
function refusedFields(body: Buffer): BillingDetailsField[] {
  try {
    const parsed = fieldErrorsSchema.safeParse(JSON.parse(body.toString("utf8")));
    const paths = parsed.success ? (parsed.data.errors ?? []).map((error) => error.path) : [];
    return BILLING_DETAILS_FIELDS.filter((field) => paths.includes(`/${field}`));
  } catch {
    return [];
  }
}

const storePath = (storeId: string, rest = "") =>
  `/stores/${encodeURIComponent(storeId)}/billing${rest}`;

/** The overview, the policy's words in `lang`: `fr` for a French dashboard, else `en`. */
export function getBillingOverview(
  storeId: string,
  locale: string,
  options: BillingClientOptions = {},
) {
  const lang = locale.startsWith("fr") ? "fr" : "en";
  return callPage(
    { method: "GET", path: storePath(storeId), query: `lang=${lang}` },
    overviewSchema,
    null,
    options,
  );
}

export function getBillingStatements(storeId: string, options: BillingClientOptions = {}) {
  return callPage(
    { method: "GET", path: storePath(storeId, "/statements") },
    statementsSchema,
    null,
    options,
  );
}

export function getBillingStatement(
  storeId: string,
  statementId: string,
  options: BillingClientOptions = {},
): Promise<BillingPageResult<BillingStatementView>> {
  // The service takes `<period>-<currency>`; anything else names no statement.
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(statementId)) {
    return Promise.resolve({ ok: false, reason: "not_found" });
  }
  return callPage(
    { method: "GET", path: storePath(storeId, `/statements/${statementId}`) },
    statementSchema,
    null,
    options,
  );
}

export function getBillingDetails(storeId: string, options: BillingClientOptions = {}) {
  return callPage(
    { method: "GET", path: storePath(storeId, "/details") },
    detailsSchema,
    null,
    options,
  );
}

export function saveBillingDetails(
  storeId: string,
  userId: string,
  form: BillingDetailsForm,
  options: BillingClientOptions = {},
) {
  return callPage(
    { method: "POST", path: storePath(storeId, "/details") },
    z.object({ saved: z.literal(true) }),
    { ...form, userId },
    options,
  );
}

/** Stripe Checkout in setup mode for the store's card, back to `returnUrl` (README §10 step 5). */
export function startCardSetup(
  storeId: string,
  input: { readonly userId: string; readonly locale: string; readonly returnUrl: string },
  options: BillingClientOptions = {},
) {
  return callPage(
    { method: "POST", path: storePath(storeId, "/card-setups") },
    z.object({ url: z.string().url() }),
    {
      userId: input.userId,
      lang: input.locale.startsWith("fr") ? "fr" : "en",
      returnUrl: input.returnUrl,
    },
    options,
  );
}

/** The card of the Checkout the owner came back from, saved at once. */
export function finishCardSetup(
  storeId: string,
  checkoutSessionId: string,
  options: BillingClientOptions = {},
) {
  return callPage(
    {
      method: "POST",
      path: storePath(storeId, `/card-setups/${encodeURIComponent(checkoutSessionId)}/finish`),
    },
    z.object({ status: z.enum(["saved", "replaced", "pending"]) }),
    {},
    options,
  );
}
