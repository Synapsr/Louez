import assert from "node:assert/strict";
import { test } from "node:test";

import { getCustomerInitials, getStorefrontChromeVariant } from "./util.storefront-chrome";

test("home is transparent on a store subdomain and on the dashboard host", () => {
  assert.equal(getStorefrontChromeVariant("/"), "transparent");
  assert.equal(getStorefrontChromeVariant("/ar-mor", { basePath: "/ar-mor" }), "transparent");
  assert.equal(getStorefrontChromeVariant("/ar-mor/", { basePath: "/ar-mor" }), "transparent");
});

test("checkout stays compact, login uses the storefront", () => {
  assert.equal(getStorefrontChromeVariant("/checkout"), "compact");
  assert.equal(getStorefrontChromeVariant("/checkout/cancelled"), "compact");
  assert.equal(getStorefrontChromeVariant("/account/login"), "default");
  assert.equal(getStorefrontChromeVariant("/ar-mor/checkout", { basePath: "/ar-mor" }), "compact");
});

test("every other page gets the default chrome", () => {
  assert.equal(getStorefrontChromeVariant("/catalog"), "default");
  assert.equal(getStorefrontChromeVariant("/account"), "account");
  assert.equal(getStorefrontChromeVariant("/account/reservations/abc"), "account");
  assert.equal(getStorefrontChromeVariant("/checkout-guide"), "default");
});

test("a pathname outside the base path is left alone", () => {
  assert.equal(getStorefrontChromeVariant("/other/checkout", { basePath: "/ar-mor" }), "default");
});

test("the proxy's internal /{slug} path (server render) maps like the public one", () => {
  const location = { basePath: "", storeSlug: "ar-mor" };
  assert.equal(getStorefrontChromeVariant("/ar-mor", location), "transparent");
  assert.equal(getStorefrontChromeVariant("/ar-mor/checkout", location), "compact");
  assert.equal(getStorefrontChromeVariant("/ar-mor/catalog", location), "default");
  assert.equal(getStorefrontChromeVariant("/", location), "transparent");
  assert.equal(getStorefrontChromeVariant("/checkout", location), "compact");
});

test("initials come from the name, then the email", () => {
  assert.equal(getCustomerInitials({ firstName: "Anna", lastName: "Le Gall" }), "AL");
  assert.equal(getCustomerInitials({ firstName: "anna" }), "AN");
  assert.equal(getCustomerInitials({ lastName: "Le Gall" }), "LE");
  assert.equal(getCustomerInitials({ email: "teo@example.com" }), "T");
  assert.equal(getCustomerInitials({}), "");
});

test("account navigation handles tenant prefixes and excludes login", () => {
  const location = { storeSlug: "ar-mor" };
  assert.equal(getStorefrontChromeVariant("/ar-mor/account/", location), "account");
  assert.equal(getStorefrontChromeVariant("/ar-mor/account/reservations/abc", location), "account");
  assert.equal(getStorefrontChromeVariant("/ar-mor/account/login/", location), "default");
  assert.equal(getStorefrontChromeVariant("/accounting", location), "default");
});
