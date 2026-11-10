import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import { before, beforeEach, describe, test } from "node:test";

import type { ApiEffectPayloads, EffectSendContext } from "@louez/api/platform/effects";

interface ResolveContext {
  parentURL?: string;
}
type NextResolve = (specifier: string, context: ResolveContext) => { url: string };

// The senders' modules import "server-only", which throws outside Next.
const registerHooks = Reflect.get(nodeModule, "registerHooks");
if (typeof registerHooks !== "function") {
  throw new Error("This test requires node:module registerHooks");
}
registerHooks({
  resolve(specifier: string, context: ResolveContext, nextResolve: NextResolve) {
    if (specifier === "server-only") return { shortCircuit: true, url: "node:module" };
    return nextResolve(specifier, context);
  },
});

// The PostHog events of a store's setup, as the outbox senders build them:
// each event's properties must be in its allowlist, and no value may look
// like an e-mail or a phone number. A new property is added here on purpose,
// and to docs/architecture/api-and-agents.md ("Setup analytics").

/** What every event of these senders may carry, beyond its own. */
const SHARED = ["feature", "surface", "actor", "store_id"];
const ACTOR = ["credential_kind", "agent_client"];

const ALLOWED: Record<string, readonly string[]> = {
  agent_store_setup_action: [
    ...SHARED,
    ...ACTOR,
    "procedure",
    "transport",
    "confirmation_accepted",
    "fields_set",
    "fields_set_count",
    "fields_cleared",
    // SETUP_FACT_KEYS (packages/api platform/setup-analytics.ts)
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
  ],
  onboarding_store_info_saved: [
    ...SHARED,
    "is_existing_incomplete_store",
    "referral_outcome",
    "country",
    "currency",
    "has_address",
    "has_coordinates",
    "has_email",
    "has_phone",
    "store_created_by",
    "credential_kind",
    "agent_client",
  ],
  onboarding_completed: [
    ...SHARED,
    ...ACTOR,
    "reservation_mode",
    "setup_by",
    "store_created_by",
    "agent_action_count",
    "human_action_count",
    "agent_clients",
    "seconds_to_launch",
  ],
};

const EMAIL_LIKE = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const PHONE_LIKE = /\+?\d(?:[\s().-]*\d){6,}/;

/** Fails on a property outside the event's allowlist, or a value that looks personal. */
function assertSafe(event: string, properties: Record<string, unknown>) {
  const allowed = new Set(ALLOWED[event]);
  assert.ok(ALLOWED[event], `no allowlist for ${event}`);
  for (const [key, value] of Object.entries(properties)) {
    assert.ok(allowed.has(key), `${event}: unexpected property ${key}`);
    if (key.endsWith("_id")) continue;
    for (const entry of Array.isArray(value) ? value : [value]) {
      if (typeof entry !== "string") continue;
      assert.ok(!EMAIL_LIKE.test(entry), `${event}.${key} looks like an e-mail: ${entry}`);
      assert.ok(!PHONE_LIKE.test(entry), `${event}.${key} looks like a phone: ${entry}`);
    }
  }
}

describe("store setup analytics senders", () => {
  let captured: Array<{
    distinctId: string | null | undefined;
    event: string;
    properties?: Record<string, unknown>;
    identity?: unknown;
  }> = [];
  let failCapture = false;
  let claims = 0;

  const context: EffectSendContext = {
    effectId: "effect_test",
    signal: new AbortController().signal,
    throwIfAborted: () => {},
    assertClaim: async () => {
      claims += 1;
    },
  };
  const capture = async (event: (typeof captured)[number]) => {
    captured.push(event);
    if (failCapture) throw new Error("PostHog answered 503.");
    return undefined;
  };

  let setup: ReturnType<typeof import("./store-setup-effects").createStoreSetupEffectSenders>;
  let launch: ReturnType<typeof import("./store-launch-effects").createStoreLaunchEffectSenders>;
  let creation: ReturnType<
    typeof import("./store-creation-effects").createStoreCreationEffectSenders
  >;

  before(async () => {
    const { createStoreSetupEffectSenders } = await import("./store-setup-effects");
    const { createStoreLaunchEffectSenders } = await import("./store-launch-effects");
    const { createStoreCreationEffectSenders } = await import("./store-creation-effects");
    creation = createStoreCreationEffectSenders({ captureProductServerEventOrThrow: capture });
    setup = createStoreSetupEffectSenders({ captureProductServerEventOrThrow: capture });
    launch = createStoreLaunchEffectSenders({
      captureProductServerEventOrThrow: capture,
      sendPlatformStoreLaunched: async () => undefined,
    });
  });

  beforeEach(() => {
    captured = [];
    failCapture = false;
    claims = 0;
  });

  /** An action with every fact set, as no single write would. */
  const action: ApiEffectPayloads["store.agentSetupAction"] = {
    eventUuid: "0190f3f0-5b6e-7c3a-9d2e-1a2b3c4d5e6f",
    occurredAt: "2026-11-09T10:00:00.000Z",
    ownerUserId: "owner_1",
    storeId: "store_1",
    procedure: "products.create",
    credentialKind: "oauth",
    agentClient: "claude",
    transport: "mcp",
    confirmed: true,
    fieldsSet: ["deposit", "name", "price", "rateTiers"],
    fieldsCleared: ["description"],
    facts: {
      country: "FR",
      currency: "EUR",
      has_address: true,
      has_coordinates: true,
      has_email: true,
      has_phone: false,
      billing_address_same_as_store: true,
      reservation_mode: "request",
      online_payment_deposit_percentage: 30,
      business_hours_enabled: true,
      open_days_count: 5,
      days_changed_count: 7,
      closure_count: 1,
      delivery_enabled: false,
      delivery_mode: "optional",
      theme_mode: "dark",
      has_logo: true,
      has_dark_logo: false,
      has_favicon: true,
      hero_image_count: 2,
      hero_layout: "cover",
      catalog_browse_mode: "products",
      image_kind: "logo",
      product_status: "active",
      pricing_kind: "duration",
      stock_kind: "returnable",
      has_price: true,
      has_deposit: true,
      pricing_tier_count: 2,
      image_count: 3,
      unit_count: 4,
      variant_axis_count: 1,
      variant_value_count: 3,
      accessory_count: 0,
      category_count: 1,
      track_units: true,
      booking_mode_effective: "request",
    },
  };

  test("agent_store_setup_action: its allowlist, on the owner, the same id on a retry", async () => {
    failCapture = true;
    await assert.rejects(setup["store.agentSetupAction"](action, context));
    failCapture = false;
    await setup["store.agentSetupAction"](action, context);

    assert.equal(captured.length, 2);
    assert.equal(claims, 2, "the claim is checked before each try");
    for (const sent of captured) {
      assert.equal(sent.event, "agent_store_setup_action");
      assert.equal(sent.distinctId, "owner_1");
      assert.deepEqual(sent.identity, {
        eventUuid: action.eventUuid,
        occurredAt: action.occurredAt,
      });
      assertSafe(sent.event, sent.properties ?? {});
    }
    const [{ properties }] = captured;
    assert.equal(properties?.procedure, "products.create");
    assert.equal(properties?.agent_client, "claude");
    assert.equal(properties?.confirmation_accepted, true);
    assert.deepEqual(properties?.fields_set, ["deposit", "name", "price", "rateTiers"]);
    assert.equal(properties?.fields_set_count, 4);
    assert.equal(properties?.pricing_tier_count, 2);
  });

  test("an action names the agent by its fixed value, never by a client name", async () => {
    await setup["store.agentSetupAction"](
      { ...action, credentialKind: "api_key", agentClient: "n8n" },
      context,
    );
    const [{ properties }] = captured;
    assert.equal(properties?.credential_kind, "api_key");
    assert.equal(properties?.agent_client, "n8n");
    assert.ok(!("client_name" in (properties ?? {})));
  });

  test("onboarding_completed says who set the store up, within its allowlist", async () => {
    const base = {
      eventUuid: "0190f3f0-5b6e-7c3a-9d2e-1a2b3c4d5e70",
      occurredAt: "2026-11-09T11:00:00.000Z",
      ownerUserId: "owner_1",
      storeId: "store_1",
      reservationMode: "payment" as const,
    };
    await launch["store.launchAnalytics"](
      {
        ...base,
        transport: "mcp",
        actor: { credentialKind: "oauth", agentClient: "chatgpt" },
        setup: {
          createdBy: "agent",
          setupBy: "mixed",
          agentActionCount: 6,
          humanActionCount: 2,
          agentClients: ["chatgpt", "claude"],
          secondsSinceCreation: 5400,
        },
      },
      context,
    );
    // A row queued before the setup analytics: neither actor nor setup.
    await launch["store.launchAnalytics"]({ ...base, transport: "rpc" }, context);

    const [agentLaunch, oldRow] = captured;
    assertSafe("onboarding_completed", agentLaunch.properties ?? {});
    assertSafe("onboarding_completed", oldRow.properties ?? {});
    assert.deepEqual(agentLaunch.properties, {
      feature: "onboarding",
      surface: "mcp",
      actor: "mcp",
      store_id: "store_1",
      reservation_mode: "payment",
      credential_kind: "oauth",
      agent_client: "chatgpt",
      setup_by: "mixed",
      store_created_by: "agent",
      agent_action_count: 6,
      human_action_count: 2,
      agent_clients: ["chatgpt", "claude"],
      seconds_to_launch: 5400,
    });
    assert.deepEqual(oldRow.properties, {
      feature: "onboarding",
      surface: "dashboard",
      store_id: "store_1",
      reservation_mode: "payment",
    });
  });

  test("onboarding_store_info_saved of an agent's store, within its allowlist", async () => {
    await creation["store.creationAnalytics"](
      {
        eventUuid: "0190f3f0-5b6e-7c3a-9d2e-1a2b3c4d5e71",
        occurredAt: "2026-11-09T09:00:00.000Z",
        event: "store_info_saved",
        ownerUserId: "owner_1",
        transport: "mcp",
        // As services/store-creation.ts builds them.
        properties: {
          feature: "onboarding",
          surface: "dashboard",
          store_id: "store_1",
          is_existing_incomplete_store: false,
          referral_outcome: "none",
          country: "FR",
          currency: "EUR",
          has_address: true,
          has_coordinates: false,
          has_email: true,
          has_phone: true,
          store_created_by: "agent",
          credential_kind: "oauth",
          agent_client: "claude",
        },
      },
      context,
    );
    const [sent] = captured;
    assert.equal(sent.event, "onboarding_store_info_saved");
    assertSafe(sent.event, sent.properties ?? {});
    assert.equal(sent.properties?.store_created_by, "agent");
  });

  test("the guard itself fails on an unexpected property or a personal value", () => {
    assert.throws(() => assertSafe("onboarding_completed", { owner_email: "x" }));
    assert.throws(() => assertSafe("agent_store_setup_action", { fields_set: ["a@b.co"] }));
    assert.throws(() => assertSafe("agent_store_setup_action", { client_name: "Claude" }));
    assert.throws(() => assertSafe("agent_store_setup_action", { agent_client: "06 12 34 56 78" }));
  });
});
