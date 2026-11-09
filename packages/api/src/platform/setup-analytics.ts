import { apiOperations, db, stores, type Transaction } from "@louez/db";
import { and, count, eq, or, sql } from "drizzle-orm";

import { ACCOUNT_SCOPE, type CredentialKind, type Credential, type Transport } from "./actor";
import { analyticsEventIdentity, type ApiEffect } from "./effects";

/**
 * Product analytics of a store's setup: which agent set it up, what it filled
 * and how far it got before the store went live
 * (docs/architecture/api-and-agents.md, "Setup analytics").
 *
 * An agent's write (an API key or an OAuth token) on a store still offline,
 * and its go-live, queue one `store.agentSetupAction` row in the outbox, added
 * with the write's audit record (`runOperation`). Its facts are non-sensitive
 * by construction: the names of the fields the call set, and a fixed list of
 * enums, counts and yes/no (`SETUP_FACT_KEYS`). Never a value a person typed:
 * no name, e-mail, phone, address, legal identity or free text.
 */

/** The procedures that set a store up, by their path under `dashboard.`. */
const SETUP_DOMAINS = [
  "stores",
  "settings",
  "onlineStore",
  "products",
  "categories",
  "customerFields",
] as const;

/** The setup procedure a call path names (`settings.updateStoreInfo`), or null when it sets nothing up. */
export function setupProcedureName(path: readonly string[]): string | null {
  if (path.length !== 3 || path[0] !== "dashboard") return null;
  return SETUP_DOMAINS.some((domain) => domain === path[1]) ? `${path[1]}.${path[2]}` : null;
}

/** The setup procedures as `api_operations.procedure` records them, for SQL. */
const setupProcedurePatterns = SETUP_DOMAINS.map((domain) => `dashboard.${domain}.%`);

// --- Who ----------------------------------------------------------------------

/** Agents we name in analytics; anything else is `other`. */
const AGENT_CLIENT_PATTERNS: ReadonlyArray<readonly [AgentClient, RegExp]> = [
  ["claude", /claude|anthropic/i],
  ["chatgpt", /chatgpt|openai|\bgpt\b|codex/i],
  ["le_chat", /le ?chat|mistral/i],
  ["gemini", /gemini|google/i],
  ["grok", /grok|\bxai\b/i],
  ["perplexity", /perplexity/i],
  ["copilot", /copilot|microsoft/i],
  ["cursor", /cursor/i],
  ["n8n", /n8n/i],
  ["make", /\bmake\b|integromat/i],
  ["zapier", /zapier/i],
];

export type AgentClient =
  | "claude"
  | "chatgpt"
  | "le_chat"
  | "gemini"
  | "grok"
  | "perplexity"
  | "copilot"
  | "cursor"
  | "n8n"
  | "make"
  | "zapier"
  | "other";

/** The agent a client or key name points to, as a fixed value: the name itself may be anything. */
export function agentClientOf(name: string | null): AgentClient {
  if (!name) return "other";
  for (const [client, pattern] of AGENT_CLIENT_PATTERNS) {
    if (pattern.test(name)) return client;
  }
  return "other";
}

const EMAIL_LIKE = /[^\s@]+@[^\s@]+\.[^\s@]+/;
/** Seven digits or more, spaces, dots, dashes and brackets allowed between them. */
const PHONE_LIKE = /\+?\d(?:[\s().-]*\d){6,}/;

/** Whether a value could be an e-mail or a phone number. */
export function looksPersonal(value: string): boolean {
  return EMAIL_LIKE.test(value) || PHONE_LIKE.test(value);
}

/** Who made a setup write, as every setup event names it. */
export interface SetupActor {
  credentialKind: CredentialKind;
  /**
   * `agentClientOf` the client or key name; null for a session. The name
   * itself is never sent: an OAuth client declares it and a user types a
   * key's, so either may hold anything, a person's name included.
   */
  agentClient: AgentClient | null;
}

export function setupActorOf(credential: Pick<Credential, "kind" | "clientName">): SetupActor {
  return {
    credentialKind: credential.kind,
    agentClient: credential.kind === "session" ? null : agentClientOf(credential.clientName),
  };
}

// --- What ---------------------------------------------------------------------

/** Every fact an agent's setup action may carry. A new one is added here, and to the docs. */
export const SETUP_FACT_KEYS = [
  "country",
  "currency",
  "has_address",
  "has_coordinates",
  "has_email",
  "has_phone",
  "billing_address_same_as_store",
  "reservation_mode",
  "online_payment_deposit_percentage",
  "business_hours_enabled",
  "open_days_count",
  "days_changed_count",
  "closure_count",
  "delivery_enabled",
  "delivery_mode",
  "theme_mode",
  "has_logo",
  "has_dark_logo",
  "has_favicon",
  "hero_image_count",
  "hero_layout",
  "catalog_browse_mode",
  "image_kind",
  "product_status",
  "pricing_kind",
  "stock_kind",
  "has_price",
  "has_deposit",
  "pricing_tier_count",
  "image_count",
  "unit_count",
  "variant_axis_count",
  "variant_value_count",
  "accessory_count",
  "category_count",
  "track_units",
  "booking_mode_effective",
] as const;

export type SetupFactKey = (typeof SETUP_FACT_KEYS)[number];
export type SetupFacts = Partial<Record<SetupFactKey, string | number | boolean | null>>;

/** A field name as a schema declares it; anything else (a key a person typed) is left out. */
const FIELD_NAME = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

type Fields = Record<string, unknown>;

const isFields = (value: unknown): value is Fields =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
/** An object's fields, or none. */
const asFields = (value: unknown): Fields => (isFields(value) ? value : {});

/** The fields a call set (a value, or null to clear one), by name only. */
function fieldsOf(input: unknown): { set: string[]; cleared: string[] } {
  const set: string[] = [];
  const cleared: string[] = [];
  for (const [key, value] of Object.entries(asFields(input))) {
    if (value === undefined || !FIELD_NAME.test(key)) continue;
    (value === null ? cleared : set).push(key);
  }
  return { set: set.sort(), cleared: cleared.sort() };
}

const lengthOf = (value: unknown) => (Array.isArray(value) ? value.length : undefined);
const isSetString = (value: unknown) => typeof value === "string" && value.trim().length > 0;
const enumOf = (value: unknown) => (typeof value === "string" ? value : undefined);
const boolOf = (value: unknown) => (typeof value === "boolean" ? value : undefined);
/** A money string above zero ("150", "0.00" is none). */
const isPositiveAmount = (value: unknown) =>
  (typeof value === "string" || typeof value === "number") && Number(value) > 0;

/** Leaves out the facts a call did not touch. */
function defined(facts: SetupFacts): SetupFacts {
  const kept: SetupFacts = {};
  for (const key of SETUP_FACT_KEYS) if (facts[key] !== undefined) kept[key] = facts[key];
  return kept;
}

function productFacts(input: Fields): SetupFacts {
  return defined({
    product_status: enumOf(input.status),
    pricing_kind: enumOf(input.pricingKind),
    stock_kind: enumOf(input.stockKind),
    has_price: "price" in input ? isPositiveAmount(input.price) : undefined,
    has_deposit: "deposit" in input ? isPositiveAmount(input.deposit) : undefined,
    pricing_tier_count: lengthOf(input.rateTiers) ?? lengthOf(input.pricingTiers),
    image_count: lengthOf(input.images),
    unit_count: lengthOf(input.units),
    variant_axis_count: lengthOf(input.bookingAttributeAxes),
    accessory_count: lengthOf(input.accessories),
    category_count: lengthOf(input.categoryIds) ?? (input.categoryId === undefined ? undefined : 1),
    track_units: boolOf(input.trackUnits),
  });
}

/**
 * Each setup procedure's facts, from its input as parsed and its output as
 * the caller got it. A procedure with none here sends its field names only.
 * Returning null sends nothing (a go-live that launched nothing).
 */
const FACTS: Record<string, (input: Fields, output: Fields) => SetupFacts | null> = {
  "stores.create": (input) => ({
    country: enumOf(input.country) ?? null,
    currency: enumOf(input.currency) ?? null,
    has_address: isSetString(input.address),
    has_coordinates: input.latitude != null && input.longitude != null,
    has_email: isSetString(input.email),
    has_phone: isSetString(input.phone),
  }),
  "settings.updateStoreInfo": (input) =>
    defined({
      has_coordinates:
        "latitude" in input || "longitude" in input
          ? input.latitude != null && input.longitude != null
          : undefined,
    }),
  "settings.updateCompany": (input) => {
    return defined({
      country: enumOf(input.country),
      currency: enumOf(input.currency),
      billing_address_same_as_store: boolOf(asFields(input.billingAddress).sameAsStore),
    });
  },
  "settings.updateReservationRules": (input) =>
    defined({
      reservation_mode: enumOf(input.reservationMode),
      online_payment_deposit_percentage:
        typeof input.onlinePaymentDepositPercentage === "number"
          ? input.onlinePaymentDepositPercentage
          : undefined,
    }),
  "settings.updateBusinessHours": (input) => {
    const schedule = isFields(input.schedule) ? input.schedule : undefined;
    const days = schedule ? Object.values(schedule).filter((day) => day !== undefined) : [];
    return defined({
      business_hours_enabled: boolOf(input.enabled),
      days_changed_count: schedule ? days.length : undefined,
      open_days_count: schedule
        ? days.filter((day) => asFields(day).isOpen === true).length
        : undefined,
      closure_count: lengthOf(input.closurePeriods),
    });
  },
  "settings.updateDelivery": (input) =>
    defined({ delivery_enabled: boolOf(input.enabled), delivery_mode: enumOf(input.mode) }),
  "onlineStore.updateAppearance": (input) =>
    defined({
      theme_mode: enumOf(input.mode),
      has_logo: "logoUrl" in input ? isSetString(input.logoUrl) : undefined,
      has_dark_logo: "darkLogoUrl" in input ? isSetString(input.darkLogoUrl) : undefined,
      has_favicon: "faviconUrl" in input ? isSetString(input.faviconUrl) : undefined,
      hero_image_count: lengthOf(input.heroImages),
      hero_layout: enumOf(input.heroLayout),
      catalog_browse_mode: enumOf(input.catalogBrowseMode),
    }),
  "onlineStore.createImageUpload": (input) => defined({ image_kind: enumOf(input.kind) }),
  "onlineStore.completeImageUpload": (input) => defined({ image_kind: enumOf(input.kind) }),
  "products.create": productFacts,
  "products.update": productFacts,
  "products.ensureVariantDefinition": (input) =>
    defined({ variant_value_count: lengthOf(input.values) }),
  "stores.completeOnboarding": (_input, output) => {
    // Already online: nothing went live, and the store's setup is over.
    if (output.launched !== true) return null;
    const mode = asFields(output.bookingMode);
    return defined({
      reservation_mode: enumOf(mode.intended),
      booking_mode_effective: enumOf(mode.effective),
    });
  },
};

/** A setup action's field names and facts, or null when it sends nothing. */
export function setupActionFacts(
  procedure: string,
  input: unknown,
  output: unknown,
): { fieldsSet: string[]; fieldsCleared: string[]; facts: SetupFacts } | null {
  const extract = FACTS[procedure];
  const facts = extract ? extract(asFields(input), asFields(output)) : {};
  if (!facts) return null;
  const { set, cleared } = fieldsOf(input);
  return { fieldsSet: set, fieldsCleared: cleared, facts };
}

/**
 * The outbox row of an agent's setup write, or null: a session's write, a
 * procedure that sets nothing up, a store already online (`offline` false),
 * or a go-live that launched nothing. Never throws on a strange input: the
 * write has happened, its analytics must not fail it.
 */
export function agentSetupActionEffect(params: {
  credential: Pick<Credential, "kind" | "clientName">;
  transport: Transport;
  path: readonly string[];
  input: unknown;
  output: unknown;
  store: { id: string; ownerUserId: string; offline: boolean };
  /** The call carried a confirmation token: it was previewed, and accepted. */
  confirmed: boolean;
  now?: Date;
}): ApiEffect | null {
  if (params.credential.kind === "session" || !params.store.offline) return null;
  const procedure = setupProcedureName(params.path);
  if (!procedure) return null;
  const facts = setupActionFacts(procedure, params.input, params.output);
  if (!facts) return null;
  const actor = setupActorOf(params.credential);
  return {
    type: "store.agentSetupAction",
    payload: {
      ...analyticsEventIdentity(params.now ?? new Date()),
      ownerUserId: params.store.ownerUserId,
      storeId: params.store.id,
      procedure,
      credentialKind: params.credential.kind,
      agentClient: actor.agentClient ?? "other",
      transport: params.transport,
      confirmed: params.confirmed,
      ...facts,
    },
  };
}

// --- The summary at go-live -----------------------------------------------------

export type SetupBy = "human" | "agent" | "mixed";

/** The record of a store's creation (`stores.create`, on the account scope). */
const creationOf = (storeId: string) =>
  and(
    eq(apiOperations.storeId, ACCOUNT_SCOPE),
    eq(apiOperations.procedure, "dashboard.stores.create"),
    eq(apiOperations.targetId, storeId),
  );

/**
 * Who created a store: an agent when its `stores.create` came from a key or
 * a token. A store with no such record was made by the dashboard.
 */
export async function storeCreatedBy(storeId: string): Promise<"human" | "agent"> {
  const [row] = await db
    .select({ kind: apiOperations.credentialKind })
    .from(apiOperations)
    .where(and(eq(apiOperations.status, "succeeded"), creationOf(storeId)))
    .limit(1);
  return row && row.kind !== "session" ? "agent" : "human";
}

export interface StoreSetupSummary {
  /** Who created the store: an agent when its `stores.create` came from a key or a token. */
  createdBy: "human" | "agent";
  setupBy: SetupBy;
  agentActionCount: number;
  humanActionCount: number;
  /** The agents that set it up (`agentClientOf`), sorted. */
  agentClients: AgentClient[];
  /** From the store's creation to now, in whole seconds. */
  secondsSinceCreation: number | null;
}

/**
 * Who set a store up, from its audit trail (`api_operations`): its creation
 * and each setup write that succeeded, by a session (human) or by a key or a
 * token (agent). `current` counts a write still running (the go-live itself).
 * A write the dashboard made outside the API (the onboarding's own steps) has
 * no record and counts for no one.
 */
export async function readStoreSetupSummary(
  tx: Transaction,
  storeId: string,
  current?: Pick<Credential, "kind" | "clientName">,
): Promise<StoreSetupSummary> {
  const rows = await tx
    .select({
      kind: apiOperations.credentialKind,
      clientName: apiOperations.clientName,
      creation: sql<number>`${apiOperations.storeId} = ${ACCOUNT_SCOPE}`,
      total: count(),
    })
    .from(apiOperations)
    .where(
      and(
        eq(apiOperations.status, "succeeded"),
        or(
          and(
            eq(apiOperations.storeId, storeId),
            or(
              ...setupProcedurePatterns.map(
                (pattern) => sql`${apiOperations.procedure} LIKE ${pattern}`,
              ),
            ),
          ),
          creationOf(storeId),
        ),
      ),
    )
    .groupBy(
      apiOperations.credentialKind,
      apiOperations.clientName,
      sql`${apiOperations.storeId} = ${ACCOUNT_SCOPE}`,
    );

  let agentActionCount = 0;
  let humanActionCount = 0;
  let createdBy: "human" | "agent" = "human";
  const clients = new Set<AgentClient>();
  const tally = (kind: CredentialKind, clientName: string | null, total: number) => {
    if (kind === "session") {
      humanActionCount += total;
      return;
    }
    agentActionCount += total;
    clients.add(agentClientOf(clientName));
  };
  for (const row of rows) {
    const total = Number(row.total);
    tally(row.kind, row.clientName, total);
    if (Number(row.creation) && row.kind !== "session") createdBy = "agent";
  }
  if (current) tally(current.kind, current.clientName, 1);

  // On the database's clock, which wrote `created_at`.
  const [store] = await tx
    .select({ seconds: sql<number>`TIMESTAMPDIFF(SECOND, ${stores.createdAt}, NOW())` })
    .from(stores)
    .where(eq(stores.id, storeId))
    .limit(1);
  const secondsSinceCreation = store ? Math.max(0, Number(store.seconds)) : null;

  return {
    createdBy,
    setupBy: agentActionCount === 0 ? "human" : humanActionCount === 0 ? "agent" : "mixed",
    agentActionCount,
    humanActionCount,
    agentClients: [...clients].sort(),
    secondsSinceCreation,
  };
}
