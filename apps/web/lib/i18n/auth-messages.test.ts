import assert from "node:assert/strict";
import { test } from "node:test";

import { selectAuthMessages } from "./auth-messages";

// The login HTML carries its messages: only the auth pages' own, and without Louez
// Cloud's perks when the instance does not bill (design §7.3: no price on the login).

const messages = {
  auth: { login: "Connexion", perk1: "bookings", perk2: "contracts", perk3: "store", passkey: { add: "Add" } },
  common: { save: "Enregistrer" },
  dashboard: { settings: { subscription: { price: "price" } } },
};

test("only the auth pages' namespaces reach the browser", () => {
  assert.deepEqual(Object.keys(selectAuthMessages(messages, true)).sort(), ["auth", "common"]);
  assert.deepEqual(selectAuthMessages(messages, true).auth, messages.auth);
});

test("without platform billing the perks are left out, nothing else", () => {
  assert.deepEqual(selectAuthMessages(messages, false), {
    auth: { login: "Connexion", passkey: { add: "Add" } },
    common: { save: "Enregistrer" },
  });
});

test("no locale's sign-in messages promise an offer, perks included", async () => {
  // A store created from the sign-up page may be one the billing service bills, which
  // gets no free reservations and no Louez price (design §6.4: generic copy only).
  const { readdir, readFile } = await import("node:fs/promises");
  const directory = new URL("../../messages/", import.meta.url);
  for (const file of (await readdir(directory)).filter((name) => name.endsWith(".json"))) {
    const catalogue: unknown = JSON.parse(await readFile(new URL(file, directory), "utf8"));
    assert.ok(catalogue && typeof catalogue === "object" && !Array.isArray(catalogue), file);
    const messages = Object.fromEntries(Object.entries(catalogue));
    for (const billingEnabled of [false, true]) {
      const text = JSON.stringify(selectAuthMessages(messages, billingEnabled));
      assert.doesNotMatch(text, /€|£|¥|\$\s?\d|\d\s?\$|\d\s?%|%\s?\d/, file);
    }
    // The invitation names no reward, the perks no free reservations.
    const auth: unknown = messages.auth;
    assert.ok(auth && typeof auth === "object", file);
    const texts = Object.fromEntries(Object.entries(auth));
    for (const key of ["referralBanner", "referralBannerGeneric", "perk1", "perk2", "perk3"]) {
      assert.equal(typeof texts[key], "string", `${file} ${key}`);
      assert.doesNotMatch(String(texts[key]), /\{count|\d+\s*\S*\s*(réservations|reservations)/i, `${file} ${key}`);
    }
  }
});
