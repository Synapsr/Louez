import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  deriveAcquisitionChannel,
  type FirstTouch,
  firstTouchEventProperties,
  firstTouchRecord,
  parseFirstTouchCookie,
  readFirstTouch,
} from "./first-touch";

// The louez.io site's `louez_attribution` cookie, as it writes it: base64url JSON.
const cookieOf = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");

describe("parseFirstTouchCookie", () => {
  test("no cookie reads as no touch", () => {
    for (const value of [undefined, null, ""]) assert.equal(parseFirstTouchCookie(value), null);
  });

  test("a value that does not decode to an object reads as no touch", () => {
    for (const value of [
      "not base64 !!!",
      Buffer.from("{not json").toString("base64url"),
      cookieOf([1, 2]),
      cookieOf("google"),
      cookieOf(null),
      cookieOf(42),
      "%E0%A4%A", // a broken URL escape
      "a".repeat(5000),
    ]) {
      assert.equal(parseFirstTouchCookie(value), null, value.slice(0, 40));
    }
  });

  test("a valid cookie keeps the known keys, checked", () => {
    const touch = parseFirstTouchCookie(
      cookieOf({
        utm_source: " google ",
        utm_medium: "cpc",
        utm_campaign: "fr-location-materiel",
        gclid: "EAIaIQobChMI-test",
        gad_source: "1",
        landing_path: "/fr/location-velos?email=jane@example.com#top",
        referrer_domain: "WWW.Google.FR",
        ts: 1794850441218,
        // Not in the contract: dropped.
        email: "jane@example.com",
        name: "Jane",
      }),
    );
    assert.deepEqual(touch, {
      utm_source: "google",
      utm_medium: "cpc",
      utm_campaign: "fr-location-materiel",
      gclid: "EAIaIQobChMI-test",
      gad_source: "1",
      landing_path: "/fr/location-velos",
      referrer_domain: "google.fr",
      ts: 1794850441218,
    });
  });

  test("a URL-encoded cookie decodes too", () => {
    const value = encodeURIComponent(cookieOf({ utm_source: "newsletter" }));
    assert.deepEqual(parseFirstTouchCookie(value), { utm_source: "newsletter" });
  });

  test("values that are not plain short strings are dropped", () => {
    const touch = parseFirstTouchCookie(
      cookieOf({
        utm_source: 42,
        utm_medium: "x".repeat(256),
        utm_campaign: "line\nbreak",
        utm_content: "jane.doe@example.com",
        utm_term: "",
        landing_path: "https://evil.example/path",
        referrer_domain: "not a domain",
        ts: "soon",
      }),
    );
    assert.deepEqual(touch, {});
  });

  test("an e-mail address, encoded or not, is dropped wherever it hides", () => {
    const touch = parseFirstTouchCookie(
      cookieOf({
        utm_term: "jane%40example.com",
        utm_content: "jane%2540example.com",
        utm_campaign: "jane(at)example.com",
        landing_path: "/invite/jane%40example.com",
        utm_source: "newsletter",
      }),
    );
    assert.deepEqual(touch, { utm_source: "newsletter" });
  });

  test("readFirstTouch finds the cookie among the request's", () => {
    const headers = new Headers({
      cookie: `louez_referral=ABC; louez_attribution=${cookieOf({ fbclid: "fb.1" })}; other=1`,
    });
    assert.deepEqual(readFirstTouch(headers), { fbclid: "fb.1" });
    assert.equal(readFirstTouch(new Headers({ cookie: "other=1" })), null);
    assert.equal(readFirstTouch(new Headers()), null);
    assert.equal(readFirstTouch(null), null);
  });
});

describe("deriveAcquisitionChannel", () => {
  const cases: Array<[string, FirstTouch | null, string]> = [
    ["no cookie", null, "direct"],
    ["an empty cookie", {}, "direct"],
    ["a gclid", { gclid: "abc" }, "google_ads"],
    ["a gbraid", { gbraid: "abc" }, "google_ads"],
    ["a wbraid", { wbraid: "abc" }, "google_ads"],
    ["gad_source", { gad_source: "1" }, "google_ads"],
    ["google / cpc", { utm_source: "google", utm_medium: "cpc" }, "google_ads"],
    [
      "a gclid with the site's own utm",
      { gclid: "abc", utm_source: "louez", utm_medium: "header" },
      "google_ads",
    ],
    ["an fbclid", { fbclid: "fb.1" }, "meta_ads"],
    ["paid_social", { utm_source: "tiktok", utm_medium: "paid_social" }, "meta_ads"],
    ["facebook / cpc", { utm_source: "facebook", utm_medium: "cpc" }, "meta_ads"],
    ["chatgpt's utm", { utm_source: "chatgpt.com" }, "ai_assistant"],
    ["perplexity as referrer", { referrer_domain: "perplexity.ai" }, "ai_assistant"],
    ["gemini as referrer, not a search", { referrer_domain: "gemini.google.com" }, "ai_assistant"],
    ["google search", { referrer_domain: "google.fr" }, "organic"],
    ["bing search", { referrer_domain: "bing.com" }, "organic"],
    ["utm_medium=organic", { utm_source: "google", utm_medium: "organic" }, "organic"],
    ["another site", { referrer_domain: "blog.example.com" }, "referral"],
    ["a newsletter", { utm_source: "newsletter", utm_medium: "email" }, "referral"],
    ["the site's own pages", { referrer_domain: "louez.io", landing_path: "/fr" }, "direct"],
  ];
  for (const [name, touch, channel] of cases) {
    test(`${name} → ${channel}`, () => assert.equal(deriveAcquisitionChannel(touch), channel));
  }
});

describe("account_created properties", () => {
  test("a Google Ads touch, prefixed, with its channel, set once on the person", () => {
    const properties = firstTouchEventProperties({
      utm_source: "google",
      utm_medium: "cpc",
      gclid: "EAIa",
      ts: 1,
    });
    assert.deepEqual(properties, {
      first_touch_utm_source: "google",
      first_touch_utm_medium: "cpc",
      first_touch_gclid: "EAIa",
      first_touch_ts: 1,
      // The standard names too, on the event only: Marketing Analytics reads them.
      utm_source: "google",
      utm_medium: "cpc",
      gclid: "EAIa",
      acquisition_channel: "google_ads",
      attribution_cookie_present: true,
      $set_once: {
        first_touch_utm_source: "google",
        first_touch_utm_medium: "cpc",
        first_touch_gclid: "EAIa",
        first_touch_ts: 1,
        // Not `acquisition_channel`: on the person, that one is the owner's own answer.
        first_touch_acquisition_channel: "google_ads",
      },
    });
  });

  test("every utm field goes under its standard name; other click ids do not", () => {
    const properties = firstTouchEventProperties({
      utm_source: "google",
      utm_medium: "cpc",
      utm_campaign: "fr-search-velos",
      utm_term: "location velo",
      utm_content: "ad-a",
      gbraid: "gb",
      landing_path: "/fr",
    });
    for (const key of ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"]) {
      assert.equal(properties[key], properties[`first_touch_${key}`], key);
    }
    assert.equal(properties.gbraid, undefined);
    assert.equal(properties.landing_path, undefined);
    assert.equal(properties.gclid, undefined, "no gclid in the cookie, none on the event");
    const setOnce = properties.$set_once as Record<string, unknown>;
    assert.ok(Object.keys(setOnce).every((key) => key.startsWith("first_touch_")));
  });

  test("no cookie is direct, and says so", () => {
    assert.deepEqual(firstTouchEventProperties(null), {
      acquisition_channel: "direct",
      attribution_cookie_present: false,
      $set_once: { first_touch_acquisition_channel: "direct" },
    });
  });

  test("the user row keeps the touch and its channel", () => {
    assert.deepEqual(firstTouchRecord({ gclid: "EAIa" }), { gclid: "EAIa", channel: "google_ads" });
    assert.deepEqual(firstTouchRecord(null), { channel: "direct" });
  });
});
