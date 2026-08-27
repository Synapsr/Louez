import assert from "node:assert/strict";
import { test } from "node:test";

import { createLoginUrl, sanitizeCallbackUrl } from "./util.url";

const APP_URL = "https://louez.example.com";

test("accepts relative callback paths", () => {
  assert.equal(sanitizeCallbackUrl("/dashboard/reservations"), "/dashboard/reservations");
});

test("accepts absolute callbacks on the app domain and its subdomains", () => {
  assert.equal(
    sanitizeCallbackUrl("https://louez.example.com/dashboard", APP_URL),
    "https://louez.example.com/dashboard",
  );
  assert.equal(
    sanitizeCallbackUrl("https://camera.louez.example.com/rental", APP_URL),
    "https://camera.louez.example.com/rental",
  );
});

test("rejects absolute callbacks from another domain", () => {
  assert.equal(sanitizeCallbackUrl("https://example.net/phishing", APP_URL), "/dashboard");
});

test("builds a login URL with a validated callback", () => {
  assert.equal(
    createLoginUrl("https://camera.louez.example.com/rental", APP_URL),
    "/login?callbackUrl=https%3A%2F%2Fcamera.louez.example.com%2Frental",
  );
});
