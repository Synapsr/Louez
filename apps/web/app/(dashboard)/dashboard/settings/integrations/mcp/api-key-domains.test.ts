import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { API_KEY_DOMAINS } from "@louez/api/contracts/api-keys";
import { locales } from "@/i18n/config";

// The API key form lists API_KEY_DOMAINS, each under its label: every domain a
// key may hold has one in every language.

test("every domain of the API key form has a label in every locale", () => {
  for (const locale of locales) {
    const catalog = JSON.parse(
      readFileSync(new URL(`../../../../../../messages/${locale}.json`, import.meta.url), "utf8"),
    );
    const labels: Record<string, unknown> = catalog.dashboard.settings.api.domains;
    for (const domain of API_KEY_DOMAINS) {
      assert.equal(typeof labels[domain], "string", `${locale}: ${domain}`);
      assert.notEqual(labels[domain], "", `${locale}: ${domain}`);
    }
  }
});
