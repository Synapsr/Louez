import assert from "node:assert/strict";
import { test } from "node:test";

import {
  detectStoreTrade,
  isFrenchStore,
  resolveLouezCreditHref,
  type TradeProduct,
} from "./util.louez-credit";

const product = (name: string, ...categoryNames: string[]): TradeProduct => ({
  name,
  categoryNames,
});

test("a bike shop is told by its products and categories, in capitals and without accents", () => {
  const catalog = [
    product("VTTAE TREK RAIL+", "VTTAE"),
    product("VTTAE AMFLOW PX carbon", "VTTAE PREMIUM"),
    product("VTCAE TREK Charter 4+", "VTCAE"),
    product("Cargo Electrique TERN OROX", "CARGO ELECTRIQUE"),
    product("Vélo électrique urbain"),
  ];
  assert.equal(detectStoreTrade(catalog), "bike");
});

test("accessories the trade does not name leave a trade that covers half the catalog", () => {
  const catalog = [
    product("Ski baby 2-6 ans", "SKIS ENFANT"),
    product("Chaussure ski enfant 1 boucle", "ACCESSOIRES"),
    product("Casque supplémentaire", "ACCESSOIRES"),
    product("Porte Bébé", "AUTRE LOCATION"),
  ];
  assert.equal(detectStoreTrade(catalog), "ski");
});

test("a trade under half of the catalog is no trade", () => {
  const catalog = [
    product("Rosalie 4 places"),
    product("Kart à pédales enfant"),
    product("E-colors - vélo électrique"),
    product("Cambridge"),
    product("Renaissance"),
  ];
  assert.equal(detectStoreTrade(catalog), null);
});

test("two trades that each hold a real share of the catalog are no trade", () => {
  const catalog = [
    product("Skis adulte", "Ski"),
    product("Skis enfant", "Ski"),
    product("Snowboard", "Glisse"),
    product("VTT électrique", "Vélos"),
    product("Vélo de route", "Vélos"),
  ];
  assert.equal(detectStoreTrade(catalog), null);
});

test("water skiing and jet skis are watersports, not ski", () => {
  const catalog = [
    product("Jet ski 3 places"),
    product("Ski nautique initiation"),
    product("Paddle gonflable", "Stand up paddle"),
  ];
  assert.equal(detectStoreTrade(catalog), "watersport");
});

test("a word inside another word does not count", () => {
  // "velo" in "velours", "ski" in "skimboard", "sono" in "sonore".
  const catalog = [product("Nappe en velours"), product("Skimboard"), product("Jeu sonore")];
  assert.equal(detectStoreTrade(catalog), null);
});

test("tools and sound stores are told by their own items", () => {
  assert.equal(
    detectStoreTrade([
      product("Perforateur SDS", "Outillage"),
      product("Ponceuse girafe", "Outillage"),
      product("Bétonnière 160 L", "Gros œuvre"),
    ]),
    "tools",
  );
  assert.equal(
    detectStoreTrade([
      product("Enceinte 1000 W", "Sonorisation"),
      product("Table de mixage 8 voies", "Sonorisation"),
      product("Lyre LED", "Éclairage"),
    ]),
    "sound",
  );
});

test("an empty catalog is no trade", () => {
  assert.equal(detectStoreTrade([]), null);
});

test("the trade page opens in the storefront's language when it exists in it", () => {
  const bike = { trade: "bike" as const, fallbackLocale: "fr" as const };
  assert.equal(resolveLouezCreditHref(bike, "fr"), "https://louez.io/fr/pro/location-velos");
  assert.equal(resolveLouezCreditHref(bike, "en"), "https://louez.io/en/pro/bike-rental");
  assert.equal(resolveLouezCreditHref(bike, "de"), "https://louez.io/de/pro/fahrradvermietung");
});

test("a trade page missing in the storefront's language opens in French for a French store, else English", () => {
  assert.equal(
    resolveLouezCreditHref({ trade: "ski", fallbackLocale: "fr" }, "de"),
    "https://louez.io/fr/pro/location-ski",
  );
  assert.equal(
    resolveLouezCreditHref({ trade: "sound", fallbackLocale: "en" }, "it"),
    "https://louez.io/en/pro/sound-lighting-rental",
  );
});

test("without a trade the credit opens the localized home page, never the redirecting root", () => {
  const none = { trade: null, fallbackLocale: "en" as const };
  assert.equal(resolveLouezCreditHref(none, "fr"), "https://louez.io/fr");
  assert.equal(resolveLouezCreditHref(none, "es"), "https://louez.io/es");
});

test("a store is French by its country or by the language it is indexed in", () => {
  assert.equal(isFrenchStore({ country: "FR" }), true);
  assert.equal(isFrenchStore({ country: "BE", locale: "fr" }), true);
  assert.equal(isFrenchStore({ country: "DE", locale: "de" }), false);
  assert.equal(isFrenchStore(null), false);
});
