import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";

import type { PolicyInvoicing } from "@louez/db";
import type { MemberRole } from "@louez/utils";

import { billingHandoffRole, getBillingHandoffAccess } from "./handoff-access";

// Who sees "Facturation" and opens the billing pages (README §10 step 1, §12; M2 plan
// D4). The database cases are in handoff-handler.db.test.ts.

describe("billingHandoffRole", () => {
  const role = (memberRole: MemberRole, isPlatformAdmin: boolean, invoicing: PolicyInvoicing) =>
    billingHandoffRole({ memberRole, isPlatformAdmin, invoicing });

  test("the owner, only when the service bills the store", () => {
    assert.equal(role("owner", false, "service"), "owner");
    assert.equal(role("owner", false, "louez_legacy"), null, "every store in production during M2");
    assert.equal(role("owner", false, "none"), null);
  });

  test("a platform admin on any store, read-only, unless they own a store the service bills", () => {
    for (const invoicing of ["service", "louez_legacy", "none"] as const) {
      assert.equal(role("platform_admin", true, invoicing), "platform_admin", invoicing);
      assert.equal(role("member", true, invoicing), "platform_admin", invoicing);
    }
    assert.equal(role("owner", true, "service"), "owner");
    assert.equal(role("owner", true, "louez_legacy"), "platform_admin");
  });

  test("nobody else", () => {
    for (const invoicing of ["service", "louez_legacy", "none"] as const) {
      assert.equal(role("member", false, invoicing), null, invoicing);
      // A role that is not the user's own membership grants nothing without the email.
      assert.equal(role("platform_admin", false, invoicing), null, invoicing);
    }
  });
});

describe("getBillingHandoffAccess outside service mode", () => {
  const saved = {
    LOUEZ_BILLING: process.env.LOUEZ_BILLING,
    BILLING_SERVICE_URL: process.env.BILLING_SERVICE_URL,
  };
  const setEnv = (values: Record<string, string | undefined>) => {
    for (const [name, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  };
  afterEach(() => setEnv(saved));

  test("a self-hosted or legacy-cloud instance shows nobody the billing pages", async () => {
    const viewers: ReadonlyArray<readonly [MemberRole, boolean]> = [
      ["platform_admin", true],
      ["member", true],
      ["owner", true],
      ["owner", false],
    ];
    for (const env of [
      { LOUEZ_BILLING: undefined, BILLING_SERVICE_URL: undefined },
      { LOUEZ_BILLING: "off", BILLING_SERVICE_URL: "https://billing.example.test" },
      { LOUEZ_BILLING: "cloud", BILLING_SERVICE_URL: undefined },
    ]) {
      setEnv(env);
      for (const [role, isPlatformAdmin] of viewers) {
        assert.equal(
          await getBillingHandoffAccess({ id: "acc_store", role }, isPlatformAdmin),
          null,
          `${JSON.stringify(env)} ${role} admin=${isPlatformAdmin}`,
        );
      }
    }
  });
});
