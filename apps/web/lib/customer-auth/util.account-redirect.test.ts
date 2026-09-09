import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  buildLoginPath,
  getInstantAccessRedirectPath,
  getSafeAccountRedirect,
  parseLoginErrorCode,
  parseReservationOutcomeEvent,
} from "./util.account-redirect";

describe("getSafeAccountRedirect", () => {
  test("keeps account paths", () => {
    assert.equal(getSafeAccountRedirect("/account"), "/account");
    assert.equal(getSafeAccountRedirect("/account/reservations/abc"), "/account/reservations/abc");
    assert.equal(
      getSafeAccountRedirect("/account/reservations/abc?event=paid"),
      "/account/reservations/abc?event=paid",
    );
  });

  test("allows only the exact checkout destination", () => {
    assert.equal(getSafeAccountRedirect("/checkout"), "/checkout");
    for (const path of [
      "//checkout",
      "/checkout/../admin",
      "/checkout?redirect=//evil.example",
      "/checkout-other",
    ]) {
      assert.equal(getSafeAccountRedirect(path), "/account");
    }
    const login = buildLoginPath({ redirect: "/checkout" });
    assert.equal(
      getSafeAccountRedirect(new URL(login, "https://store.example").searchParams.get("redirect")),
      "/checkout",
    );
  });

  test("falls back to /account for anything else", () => {
    assert.equal(getSafeAccountRedirect(null), "/account");
    assert.equal(getSafeAccountRedirect(""), "/account");
    assert.equal(getSafeAccountRedirect("/catalog"), "/account");
    assert.equal(getSafeAccountRedirect("//evil.example/account"), "/account");
    assert.equal(getSafeAccountRedirect("https://evil.example/account"), "/account");
    assert.equal(getSafeAccountRedirect("/accounting"), "/account");
    assert.equal(getSafeAccountRedirect(["/catalog", "/account"]), "/account");
  });
});

describe("getInstantAccessRedirectPath", () => {
  const base = "/account/reservations/r1";

  test("allows the reservation page, its contract and a known event", () => {
    assert.equal(getInstantAccessRedirectPath(null, "r1"), base);
    assert.equal(getInstantAccessRedirectPath(base, "r1"), base);
    assert.equal(getInstantAccessRedirectPath(`${base}/contract`, "r1"), `${base}/contract`);
    assert.equal(getInstantAccessRedirectPath(`${base}?event=paid`, "r1"), `${base}?event=paid`);
    assert.equal(
      getInstantAccessRedirectPath(`${base}?event=requested`, "r1"),
      `${base}?event=requested`,
    );
  });

  test("rejects other reservations, unknown events and extra params", () => {
    assert.equal(getInstantAccessRedirectPath("/account/reservations/r2", "r1"), base);
    assert.equal(getInstantAccessRedirectPath(`${base}?event=hacked`, "r1"), base);
    assert.equal(getInstantAccessRedirectPath(`${base}?event=paid&next=//x`, "r1"), base);
    assert.equal(getInstantAccessRedirectPath("/catalog", "r1"), base);
  });
});

describe("parseReservationOutcomeEvent / parseLoginErrorCode", () => {
  test("returns known values only", () => {
    assert.equal(parseReservationOutcomeEvent("paid"), "paid");
    assert.equal(parseReservationOutcomeEvent(["deposit_authorized"]), "deposit_authorized");
    assert.equal(parseReservationOutcomeEvent("nope"), null);
    assert.equal(parseLoginErrorCode("invalidToken"), "invalidToken");
    assert.equal(parseLoginErrorCode("x"), null);
  });
});

describe("buildLoginPath", () => {
  test("omits the default redirect and encodes the rest", () => {
    assert.equal(buildLoginPath({}), "/account/login");
    assert.equal(buildLoginPath({ redirect: "/account" }), "/account/login");
    assert.equal(
      buildLoginPath({ redirect: "/account/reservations/r1?event=paid", error: "invalidToken" }),
      "/account/login?error=invalidToken&redirect=%2Faccount%2Freservations%2Fr1%3Fevent%3Dpaid",
    );
  });
});
