import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";

import {
  type FakeBillingService,
  startFakeBillingService,
  useFakeServiceEnv,
} from "./fake-billing-service.fixtures";
import {
  getBillingDetails,
  getBillingOverview,
  getBillingStatement,
  saveBillingDetails,
  startCardSetup,
} from "./pages";

// The billing pages' calls (louez-billing docs/api, README §10) against a fake billing
// service that checks Louez's signatures and signs its answers.

const OVERVIEW = {
  at: "2027-02-10T09:00:00.000Z",
  timeZone: "Europe/Paris",
  tariff: { kind: "offer", label: "Test" },
  card: "missing",
  savedCard: null,
  notice: null,
  blocked: "payment_method_required",
  month: {
    period: "2027-02",
    currencies: [{ currency: "EUR", atSourceMinor: 0, dueMinor: 0 }],
    statementAt: "2027-03-01T00:00:00.000Z",
  },
  cardSetupUnavailable: null,
};

const FORM = {
  legalName: "Location Test",
  email: "x",
  line1: "1 rue Test",
  line2: "",
  postalCode: "29200",
  city: "Brest",
  state: "",
  country: "FR",
  vatNumber: "",
};

describe("billing pages calls", () => {
  let service: FakeBillingService;
  let restoreEnv: () => void;

  before(async () => {
    service = await startFakeBillingService();
    restoreEnv = useFakeServiceEnv(service);
  });
  after(async () => {
    await service?.close();
    restoreEnv?.();
  });

  test("reads the overview in the dashboard's language, signed both ways", async () => {
    service.handle("/stores/pg_store/billing", () => ({ status: 200, body: OVERVIEW }));
    const fr = await getBillingOverview("pg_store", "fr");
    assert.ok(fr.ok);
    assert.equal(fr.value.card, "missing");
    assert.equal(fr.value.month?.currencies[0]?.currency, "EUR");
    await getBillingOverview("pg_store", "de");
    const targets = service.requests
      .filter((request) => request.target.includes("/stores/pg_store/billing"))
      .map((request) => [request.method, request.target, request.verified]);
    assert.deepEqual(targets, [
      ["GET", "/api/v1/louez/stores/pg_store/billing?lang=fr", true],
      ["GET", "/api/v1/louez/stores/pg_store/billing?lang=en", true],
    ]);
  });

  test("says why it has nothing: setting up, not found, unavailable, or failed", async () => {
    service.handle("/stores/pg_new/billing/details", () => ({
      status: 404,
      body: { code: "store_unknown" },
    }));
    assert.deepEqual(await getBillingDetails("pg_new"), { ok: false, reason: "store_unknown" });

    service.handle("/stores/pg_store/billing/statements/2027-01-EUR", () => ({
      status: 404,
      body: { code: "not_found" },
    }));
    assert.deepEqual(await getBillingStatement("pg_store", "2027-01-EUR"), {
      ok: false,
      reason: "not_found",
    });
    // An id that is no statement id is never sent.
    const sent = service.requests.length;
    assert.deepEqual(await getBillingStatement("pg_store", "../details"), {
      ok: false,
      reason: "not_found",
    });
    assert.equal(service.requests.length, sent);

    service.handle("/stores/pg_store/billing/card-setups", () => ({
      status: 409,
      body: { code: "unavailable" },
    }));
    const started = await startCardSetup("pg_store", {
      userId: "owner1",
      locale: "fr",
      returnUrl: "https://app.louez.test/dashboard/settings/billing",
    });
    assert.deepEqual(started, { ok: false, reason: "unavailable" });
    const body = service.requests.at(-1)?.json();
    assert.deepEqual(body, {
      userId: "owner1",
      lang: "fr",
      returnUrl: "https://app.louez.test/dashboard/settings/billing",
    });

    // An answer that is not signed, or not the contract's, is never read.
    service.handle("/stores/pg_unsigned/billing", () => ({
      status: 200,
      body: OVERVIEW,
      signed: false,
    }));
    assert.deepEqual(await getBillingOverview("pg_unsigned", "fr"), {
      ok: false,
      reason: "failed",
    });
    service.handle("/stores/pg_odd/billing", () => ({
      status: 200,
      body: { ...OVERVIEW, card: "gold" },
    }));
    assert.deepEqual(await getBillingOverview("pg_odd", "fr"), { ok: false, reason: "failed" });
  });

  test("names the form fields the service refuses", async () => {
    service.handle("/stores/pg_store/billing/details", () => ({
      status: 400,
      body: {
        code: "invalid_request",
        errors: [
          { path: "/email", code: "refused", message: "was refused" },
          { path: "/userId", code: "invalid_format", message: "has an invalid format" },
        ],
      },
    }));
    assert.deepEqual(await saveBillingDetails("pg_store", "owner1", FORM), {
      ok: false,
      reason: "invalid",
      fields: ["email"],
    });
    assert.deepEqual(service.requests.at(-1)?.json(), { ...FORM, userId: "owner1" });
  });
});
