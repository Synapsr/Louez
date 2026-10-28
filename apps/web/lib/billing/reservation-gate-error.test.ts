import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

import { createTranslator } from "next-intl";

import { STORE_NOT_ACCEPTING_RESERVATIONS_ERROR } from "@louez/types";

import { locales } from "@/i18n/config";

import { renterGateRefusalParams } from "./reservation-gate-error";

// What a renter reads when the card gate refuses a booking (design §4.7): the store
// isn't taking reservations online, and how to reach it. Never a billing reason.

const KEY = STORE_NOT_ACCEPTING_RESERVATIONS_ERROR.slice("errors.".length);

function errorsCatalog(locale: string): Record<string, string> {
  const catalog: unknown = JSON.parse(
    readFileSync(new URL(`../../messages/${locale}.json`, import.meta.url), "utf8"),
  );
  assert.ok(catalog && typeof catalog === "object" && "errors" in catalog);
  const errors = catalog.errors;
  assert.ok(errors && typeof errors === "object" && KEY in errors);
  const message = Reflect.get(errors, KEY);
  assert.equal(typeof message, "string");
  return { [KEY]: String(message) };
}

function renterMessage(locale: string, store: { phone: string | null; email: string | null }) {
  const t = createTranslator({
    locale,
    messages: errorsCatalog(locale),
    onError: (error) => {
      throw error;
    },
  });
  return t(KEY, renterGateRefusalParams(store));
}

describe("renterGateRefusalParams", () => {
  test("the store's phone, then its email", () => {
    assert.deepEqual(
      renterGateRefusalParams({ phone: " +33 6 12 34 56 78 ", email: "shop@example.test" }),
      { hasContact: "yes", contact: "+33 6 12 34 56 78 · shop@example.test" },
    );
    assert.deepEqual(renterGateRefusalParams({ phone: null, email: "shop@example.test" }), {
      hasContact: "yes",
      contact: "shop@example.test",
    });
  });

  test("a store with no phone and no email has no contact", () => {
    for (const store of [
      { phone: null, email: null },
      { phone: "  ", email: "" },
    ]) {
      assert.deepEqual(renterGateRefusalParams(store), { hasContact: "no", contact: "" });
    }
  });
});

describe("the renter's message", () => {
  test("shows the store's contact in every locale", () => {
    for (const locale of locales) {
      const message = renterMessage(locale, {
        phone: "+33 6 12 34 56 78",
        email: "shop@example.test",
      });
      assert.ok(message.includes("+33 6 12 34 56 78 · shop@example.test"), `${locale}: ${message}`);
    }
  });

  test("without a contact, says to contact the store, with no placeholder left", () => {
    for (const locale of locales) {
      const message = renterMessage(locale, { phone: null, email: null });
      assert.doesNotMatch(message, /[{}]/, locale);
      assert.notEqual(
        message,
        renterMessage(locale, { phone: null, email: "shop@example.test" }),
        locale,
      );
    }
  });

  test("never names billing, a card or a payment", () => {
    for (const locale of ["en", "fr"]) {
      for (const store of [
        { phone: null, email: null },
        { phone: "+33 6 12 34 56 78", email: null },
      ]) {
        assert.doesNotMatch(
          renterMessage(locale, store),
          /billing|factur|card|carte|paiement|payment/i,
          locale,
        );
      }
    }
  });
});
