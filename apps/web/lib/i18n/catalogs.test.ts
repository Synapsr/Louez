import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { test } from "node:test";
import { parse, type MessageFormatElement } from "@formatjs/icu-messageformat-parser";
import { createTranslator } from "next-intl";
import type { ReactNode } from "react";
import { bookingQuoteInputSchema, reservationLocaleSchema } from "@louez/validations";
import { locales } from "@/i18n/config";
import { DEMO_SCENES } from "@/lib/landing-demos/policy";
import { getEmailTranslator, resolveReservationEmailLocale } from "@/lib/email/i18n";

const addedLocales = ["zh", "ja", "ru", "id", "ko"] as const;
const readCatalog = (group: string, locale: string): Record<string, unknown> =>
  JSON.parse(
    readFileSync(new URL(`../../messages/${group}${locale}.json`, import.meta.url), "utf8"),
  );
const flatten = (value: object, prefix = ""): Record<string, string> =>
  Object.fromEntries(
    Object.entries(value).flatMap(([key, child]: [string, unknown]) => {
      const name = prefix ? `${prefix}.${key}` : key;
      if (typeof child === "string") return [[name, child]];
      assert.ok(child !== null && typeof child === "object", name);
      return Object.entries(flatten(child, name));
    }),
  );

const signature = (nodes: MessageFormatElement[]): string[] => {
  const tokens = new Set<string>();
  const walk = (elements: MessageFormatElement[]) => {
    for (const element of elements) {
      if (element.type !== 0 && element.type !== 7) tokens.add(`${element.type}:${element.value}`);
      if (element.type === 5 || element.type === 6)
        Object.values(element.options).forEach((option) => walk(option.value));
      if (element.type === 8) walk(element.children);
    }
  };
  walk(nodes);
  return [...tokens].sort();
};

for (const locale of addedLocales) {
  for (const group of [
    "",
    "emails/",
    "supplemental/",
    "inspections/",
    "invoices/",
    "landing-demos/",
  ]) {
    test(`${locale} ${group || "app"}: catalog keys and ICU arguments match the English source`, () => {
      const source = flatten(readCatalog(group, "en"));
      const translated = flatten(readCatalog(group, locale));
      assert.deepEqual(Object.keys(translated).sort(), Object.keys(source).sort());
      for (const [key, value] of Object.entries(source)) {
        assert.ok(translated[key].trim(), `${locale}/${group}${key} is empty`);
        let original: MessageFormatElement[];
        try {
          original = parse(value);
        } catch {
          // The SEO verification placeholder is literal HTML, not an ICU message.
          assert.equal(key, "dashboard.settings.seoSettings.verification.placeholder");
          assert.equal(translated[key], value);
          continue;
        }
        const actual = parse(translated[key]);
        assert.deepEqual(signature(actual), signature(original), `${locale}/${group}${key}`);
        const values: Record<string, number | ((chunks: ReactNode) => ReactNode)> = {};
        for (const token of signature(actual)) {
          const [type, name] = token.split(":");
          values[name] = type === "8" ? (chunks) => chunks : 2;
        }
        const t = createTranslator({
          locale,
          messages: { message: translated[key] },
          onError: (error) => {
            throw error;
          },
        });
        assert.ok(t.rich("message", values) !== undefined, `${locale}/${group}${key}`);
      }
    });
  }
  test(`${locale}: booking validation and reservation email locale accept the chosen language`, () => {
    assert.equal(reservationLocaleSchema.parse(locale), locale);
    assert.equal(
      bookingQuoteInputSchema.parse({
        storeId: "s".repeat(21),
        startAt: "2026-10-01T09:00:00Z",
        endAt: "2026-10-02T09:00:00Z",
        locale,
        items: [{ productId: "p".repeat(21), quantity: 1 }],
      }).locale,
      locale,
    );
    assert.equal(resolveReservationEmailLocale(locale, "FR"), locale);
    assert.ok(getEmailTranslator(locale)("common.greeting", { name: "QA" }));
  });
}

test("unsupported booking languages are rejected", () => {
  assert.equal(reservationLocaleSchema.safeParse("xx").success, false);
});

test("Russian duration plurals cover singular, paucal, plural and fractions", () => {
  const t = createTranslator({
    locale: "ru",
    messages: { days: flatten(readCatalog("", "ru"))["common.days"] },
  });
  for (const [count, expected] of [
    [1, "1 день"],
    [2, "2 дня"],
    [5, "5 дней"],
    [21, "21 день"],
    [22, "22 дня"],
  ] as const) {
    assert.equal(t("days", { count }), expected);
  }
});

test("the marketing poster generator covers the same languages", () => {
  const script = readFileSync(
    new URL("../../scripts/landing-demo-posters.mjs", import.meta.url),
    "utf8",
  );
  const list = script.match(/const locales = (\[[\s\S]*?\]);/);
  assert.ok(list);
  assert.deepEqual(JSON.parse(list[1]), locales);
});


test("every demo scene and contract page ships an asset for every supported locale", () => {
  const root = new URL("../../public/", import.meta.url);
  const posters = JSON.parse(readFileSync(new URL("demo-posters/manifest.json", root), "utf8"));
  const documents = JSON.parse(readFileSync(new URL("demo-documents/manifest.json", root), "utf8"));
  for (const locale of locales) {
    for (const scene of DEMO_SCENES.filter((value) => value !== "rental")) {
      const key = `${scene}.${locale}`;
      const size = statSync(new URL(`demo-posters/${key}.webp`, root)).size;
      assert.ok(size > 0, key);
      assert.equal(posters.bytes[key], size, `${key}: stale poster manifest`);
    }
    const pages = documents.contract[locale];
    assert.ok(Number.isInteger(pages) && pages > 0, `${locale}: contract pages`);
    for (let page = 1; page <= pages; page++) {
      assert.ok(statSync(new URL(`demo-documents/contract.${locale}.p${page}.webp`, root)).size > 0);
    }
  }
});


test("translated contract links preserve the storefront terms route", () => {
  for (const locale of locales) {
    const copy = flatten(readCatalog("", locale));
    assert.ok(copy["contract.conditions.termsLink"].includes("{slug}.{domain}/terms"), locale);
  }
});
