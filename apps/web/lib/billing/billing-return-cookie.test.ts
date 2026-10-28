import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { BILLING_RETURN_PATH } from "./billing-return";
import {
  BILLING_RETURN_COOKIE_PATH,
  rememberBillingReturnOrigin,
  takeBillingReturnOrigin,
} from "./billing-return-cookie";
import { fakeCookieJar } from "./billing-return-cookie.fixtures";
import {
  BILLING_CARD_STEP_PATH,
  BILLING_HANDOFF_PATH,
  BILLING_SETTINGS_PATH,
} from "./billing-routes";

// The cookie that carries where a hand-off left from to its return (louez-billing
// docs/api, README §10 step 4: `return_url` takes no query).

const NAME = "louez_billing_return";

/** Whether a browser sends a cookie of `cookiePath` with a request for `requestPath` (RFC 6265 §5.1.4). */
function pathMatches(requestPath: string, cookiePath: string): boolean {
  if (requestPath === cookiePath) return true;
  if (!requestPath.startsWith(cookiePath)) return false;
  return cookiePath.endsWith("/") || requestPath[cookiePath.length] === "/";
}

describe("rememberBillingReturnOrigin", () => {
  test("keeps the origin in an HttpOnly, SameSite=Lax cookie for one billing session", () => {
    const cookies = fakeCookieJar();
    rememberBillingReturnOrigin(cookies.jar, "onboarding", "https://app.louez.test/");
    assert.deepEqual(cookies.writes, [
      {
        op: "set",
        name: NAME,
        value: "onboarding",
        options: {
          httpOnly: true,
          secure: true,
          sameSite: "lax",
          // README §10: a billing session lasts 2 hours at most.
          maxAge: 7200,
          path: "/dashboard/billing",
        },
      },
    ]);
  });

  test("the browser sends it to the hand-off and its return, and to no other page", () => {
    assert.ok(pathMatches(BILLING_HANDOFF_PATH, BILLING_RETURN_COOKIE_PATH));
    assert.ok(pathMatches(BILLING_RETURN_PATH, BILLING_RETURN_COOKIE_PATH));
    for (const path of [
      BILLING_CARD_STEP_PATH,
      BILLING_SETTINGS_PATH,
      "/dashboard",
      "/dashboard/billingx",
    ]) {
      assert.ok(!pathMatches(path, BILLING_RETURN_COOKIE_PATH), path);
    }
  });

  test("Secure over HTTPS only, so a local http dashboard keeps it", () => {
    const cookies = fakeCookieJar();
    rememberBillingReturnOrigin(cookies.jar, "onboarding", "http://localhost:3000");
    const [write] = cookies.writes;
    assert.equal(write?.op === "set" && write.options.secure, false);
  });

  test("a hand-off from the settings forgets an earlier one's origin, on the cookie's path", () => {
    const earlier = fakeCookieJar({ [NAME]: "onboarding" });
    rememberBillingReturnOrigin(earlier.jar, null, "https://app.louez.test");
    assert.deepEqual(earlier.writes, [{ op: "delete", name: NAME, path: "/dashboard/billing" }]);

    const none = fakeCookieJar();
    rememberBillingReturnOrigin(none.jar, null, "https://app.louez.test");
    assert.deepEqual(none.writes, [], "no Set-Cookie when there is nothing to forget");
  });
});

describe("takeBillingReturnOrigin", () => {
  test("reads the origin once, and clears the cookie on its path", () => {
    const cookies = fakeCookieJar({ [NAME]: "onboarding" });
    assert.equal(takeBillingReturnOrigin(cookies.jar), "onboarding");
    assert.deepEqual(cookies.writes, [{ op: "delete", name: NAME, path: "/dashboard/billing" }]);
    assert.equal(
      takeBillingReturnOrigin(cookies.jar),
      null,
      "a second return goes to the settings",
    );
  });

  test("a value Louez does not know goes to the settings, and is cleared too", () => {
    const cookies = fakeCookieJar({ [NAME]: "https://evil.test" });
    assert.equal(takeBillingReturnOrigin(cookies.jar), null);
    assert.deepEqual(cookies.writes, [{ op: "delete", name: NAME, path: "/dashboard/billing" }]);
  });

  test("without the cookie: the settings, and no Set-Cookie", () => {
    const cookies = fakeCookieJar({ other: "x" });
    assert.equal(takeBillingReturnOrigin(cookies.jar), null);
    assert.deepEqual(cookies.writes, []);
  });
});
