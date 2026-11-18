import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { createTranslator } from "next-intl";

import { buildLlmsTxt, type LlmsTxtInput } from "./util.llms-txt";

const messages = (locale: string) =>
  JSON.parse(readFileSync(new URL(`../../messages/${locale}.json`, import.meta.url), "utf8"));

const translator = (locale: string) => {
  const t = createTranslator({ locale, messages: messages(locale), namespace: "storefront.llms" });
  return (key: string, values?: Record<string, string | number>) =>
    t(key as Parameters<typeof t>[0], values);
};

const input: LlmsTxtInput = {
  store: {
    name: "Vélos du Port",
    url: "https://velos.louez.io",
    tagline: "Vélos et kayaks à louer sur le port de Vannes",
    description: "Location de vélos électriques et de kayaks, à la journée ou à la semaine.",
    address: "12 quai Tabarly, 56000 Vannes",
    phone: "+33 2 97 00 00 00",
    email: "bonjour@velos.example",
    mapUrl: "https://www.google.com/maps/search/?api=1&query=47.65,-2.76",
    currency: "EUR",
    hours: [
      { days: "lundi – vendredi", ranges: ["09:00–18:00"], isOpen: true },
      { days: "samedi – dimanche", ranges: [], isOpen: false },
    ],
    booking: {
      mode: "payment",
      onlinePaymentPercent: 30,
      minDuration: "2 heures",
      maxDuration: null,
      advanceNotice: "1 jour",
    },
    fulfilment: { pickup: true, multiLocation: false, delivery: "optional" },
    pages: {
      catalog: "https://velos.louez.io/catalog",
      about: "https://velos.louez.io/about",
      contact: "https://velos.louez.io/contact",
      terms: null,
      legal: "https://velos.louez.io/legal",
    },
  },
  products: [
    {
      name: "Vélo électrique [VAE]",
      url: "https://velos.louez.io/product/velo-electrique",
      category: "Vélos",
      description: "Autonomie 80 km, casque fourni.",
      rates: ["25 € / 1 jour", "120 € / 7 jours"],
      deposit: "300 €",
    },
    {
      name: "Kayak biplace",
      url: "https://velos.louez.io/product/kayak",
      category: null,
      description: null,
      rates: ["40 € (Forfait)"],
      deposit: null,
    },
  ],
  full: false,
  readAt: "18 novembre 2026",
  fullUrl: "https://velos.louez.io/llms-full.txt",
  truncated: false,
};

test("llms.txt follows the format: a title, a summary, then sections of links", () => {
  const text = buildLlmsTxt(input, translator("fr"));
  const lines = text.split("\n");
  assert.equal(lines[0], "# Vélos du Port");
  assert.equal(lines[2], "> Vélos et kayaks à louer sur le port de Vannes");
  assert.ok(text.includes("## Informations pratiques"));
  assert.ok(text.includes("## Catalogue"));
  assert.ok(text.includes("## Optional\n\n- [Tous les produits, avec leur description](https://velos.louez.io/llms-full.txt)"));
  assert.ok(text.endsWith("Données de la boutique en ligne, à jour au 18 novembre 2026.\n"));
});

test("llms.txt carries the store's facts and every product's rates and deposit", () => {
  const text = buildLlmsTxt(input, translator("fr"));
  for (const fact of [
    "- Adresse : 12 quai Tabarly, 56000 Vannes",
    "- Téléphone : +33 2 97 00 00 00",
    "- Horaires : lundi – vendredi 09:00–18:00 ; samedi – dimanche fermé",
    "- Réservation en ligne avec un acompte de 30 % ; le reste se règle à la boutique",
    "- Durée minimale de location : 2 heures",
    "- À réserver au moins 1 jour à l'avance",
    "- Retrait et retour à la boutique",
    "- Livraison possible",
    "- Prix en EUR",
    // Square brackets would end the link label early.
    "- [Vélo électrique VAE](https://velos.louez.io/product/velo-electrique): 25 € / 1 jour ; 120 € / 7 jours. Caution : 300 €",
    "- [Kayak biplace](https://velos.louez.io/product/kayak): 40 € (Forfait)",
  ]) {
    assert.ok(text.includes(fact), fact);
  }
  // No maximum, no terms of its own: neither line appears.
  assert.ok(!text.includes("Durée maximale"));
  assert.ok(!text.includes("Conditions générales"));
  // The uncategorized product comes under its own heading, after the named category.
  assert.ok(text.indexOf("### Vélos") < text.indexOf("### Autres produits"));
});

test("llms-full.txt adds the descriptions and drops the Optional link", () => {
  const text = buildLlmsTxt({ ...input, full: true }, translator("fr"));
  assert.ok(text.includes("  Autonomie 80 km, casque fourni."));
  assert.ok(!text.includes("## Optional"));
});

test("a store without products or contact still reads well, in its own language", () => {
  const text = buildLlmsTxt(
    {
      ...input,
      products: [],
      store: {
        ...input.store,
        tagline: null,
        description: null,
        address: null,
        phone: null,
        email: null,
        mapUrl: null,
        hours: [],
        booking: { ...input.store.booking, mode: "request" },
      },
    },
    translator("en"),
  );
  assert.ok(text.includes("> Equipment rental at Vélos du Port."));
  assert.ok(text.includes("No product online yet."));
  assert.ok(text.includes("- Booking online on request: the store confirms each booking"));
  assert.ok(!text.includes("Address:"));
  assert.ok(!text.includes("Opening hours:"));
});

test("every locale has every label llms.txt uses", () => {
  for (const locale of ["de", "en", "es", "fr", "id", "it", "ja", "ko", "nl", "pl", "pt", "ru", "zh"]) {
    const text = buildLlmsTxt({ ...input, truncated: true }, translator(locale));
    assert.ok(!text.includes("storefront.llms"), `${locale}: a key is missing`);
  }
});
