import assert from "node:assert/strict";
import { test } from "node:test";

import {
  type OnlineStoreEditorStore,
  type OnlineStoreFormValues,
  buildOnlineStoreDefaults,
  buildOnlineStorePayload,
  isSameValue,
  listDirtySections,
  listReplacedImages,
  listUnsavedImages,
  parseHexInput,
} from "./util.online-store-form";

const store: OnlineStoreEditorStore = {
  id: "s1",
  name: "Ar Mor Location",
  slug: "ar-mor-location",
  tagline: "Vélos et paddles à Carnac",
  description: "<p>Depuis 2012.</p>",
  email: "contact@armor.example",
  phone: "02 97 00 00 00",
  address: "1 quai des Pêcheurs, Carnac",
  latitude: "47.5850000",
  longitude: "-3.0780000",
  logoUrl: "https://s3/s1/logo/logo.png",
  darkLogoUrl: null,
  faviconUrl: null,
  cgv: "<p>CGV</p>",
  legalNotice: null,
  includeCgvInContract: true,
  settings: {
    reservationMode: "payment",
    advanceNoticeMinutes: 1440,
    locale: "fr",
    seo: { googleSiteVerification: "abc" },
    social: { instagram: "https://instagram.com/armor" },
    footerNote: "SIRET 123",
    contact: {
      layout: "message",
      primaryChannel: "email",
      phone: false,
      sms: false,
      whatsapp: false,
      whatsappNumber: null,
      email: true,
      form: true,
      formRecipientEmail: null,
      formPhoneField: "hidden",
      intro: "Écrivez-nous",
    },
  },
  theme: {
    mode: "dark",
    primaryColor: "#0d9488",
    heroImages: ["https://s3/s1/logo/hero-1.jpg"],
    heroLayout: "split",
    heroAlign: "end",
    heroVerticalAlign: "center",
    catalogBrowseMode: "categories",
    maxDiscountPercent: 30,
    announcement: { enabled: true, text: "Fermé le 15 août", href: null },
    homeSections: { map: false, reviews: true, reassurance: true },
    shareImageUrl: "https://s3/s1/logo/share.jpg",
    headerPhone: true,
  },
};

const baseline = buildOnlineStoreDefaults(store);

const clone = (values: OnlineStoreFormValues): OnlineStoreFormValues =>
  JSON.parse(JSON.stringify(values)) as OnlineStoreFormValues;

test("defaults read every section from the row", () => {
  assert.equal(baseline.identity.tagline, "Vélos et paddles à Carnac");
  assert.equal(baseline.identity.themeMode, "dark");
  assert.equal(baseline.identity.locale, "fr");
  assert.equal(baseline.home.heroLayout, "split");
  assert.equal(baseline.home.maxDiscountEnabled, true);
  assert.equal(baseline.home.announcementEnabled, true);
  assert.equal(baseline.home.showMap, false);
  assert.equal(baseline.contact.latitude, 47.585);
  assert.equal(baseline.contact.channels.layout, "message");
  assert.equal(baseline.contact.channels.formRecipientEmail, "");
  assert.equal(baseline.contact.social.instagram, "https://instagram.com/armor");
  assert.equal(baseline.contact.social.tiktok, "");
  assert.equal(baseline.contact.headerPhone, true);
  assert.equal(baseline.legal.footerNote, "SIRET 123");
  assert.equal(baseline.seo.shareImageUrl, "https://s3/s1/logo/share.jpg");
});

test("a store without theme or settings gets the storefront defaults", () => {
  const defaults = buildOnlineStoreDefaults({
    ...store,
    tagline: null,
    settings: null,
    theme: null,
    faviconUrl: null,
  });
  assert.equal(defaults.identity.themeMode, "light");
  assert.equal(defaults.identity.primaryColor, "#2563eb");
  assert.equal(defaults.identity.locale, "");
  assert.deepEqual(defaults.home.heroImages, []);
  assert.equal(defaults.home.heroAlign, "center");
  assert.equal(defaults.home.maxDiscountEnabled, false);
  assert.equal(defaults.home.showMap, true);
  assert.equal(defaults.contact.channels.layout, "full");
  assert.equal(defaults.contact.headerPhone, false);
  assert.equal(defaults.legal.footerNote, "");
});

test("only the sections that changed are sent", () => {
  const value = clone(baseline);
  value.legal.footerNote = "SIRET 456";
  value.seo.googleSiteVerification = "xyz";

  assert.deepEqual(listDirtySections(value, baseline), ["legal", "seo"]);

  const payload = buildOnlineStorePayload({ value, baseline });
  assert.ok(payload);
  assert.deepEqual(Object.keys(payload), ["legal", "seo"]);
  assert.equal(payload.legal?.footerNote, "SIRET 456");
  assert.equal(payload.seo?.googleSiteVerification, "xyz");
  // The untouched share image is re-sent as is: it is a real URL.
  assert.equal(payload.seo?.shareImageUrl, "https://s3/s1/logo/share.jpg");
});

test("an unchanged form produces an empty payload", () => {
  const payload = buildOnlineStorePayload({ value: clone(baseline), baseline });
  assert.deepEqual(payload, {});
});

test("identity maps the form to the theme and drops the dark logo of a light store", () => {
  const value = clone(baseline);
  value.identity.themeMode = "light";
  value.identity.darkLogoUrl = "https://s3/s1/logo/dark.png";
  value.identity.locale = "";

  const payload = buildOnlineStorePayload({ value, baseline });
  assert.ok(payload?.identity);
  assert.deepEqual(payload.identity.theme, { mode: "light", primaryColor: "#0d9488" });
  assert.equal(payload.identity.darkLogoUrl, null);
  assert.equal(payload.identity.locale, null);
  assert.equal(payload.identity.logoUrl, "https://s3/s1/logo/logo.png");
  assert.equal(payload.identity.faviconUrl, null);
});

test("home folds the discount switch and the announcement into the theme shape", () => {
  const value = clone(baseline);
  value.home.maxDiscountEnabled = false;
  value.home.announcementEnabled = false;

  const payload = buildOnlineStorePayload({ value, baseline });
  assert.ok(payload?.home);
  assert.equal(payload.home.maxDiscountPercent, null);
  assert.deepEqual(payload.home.announcement, {
    enabled: false,
    text: "Fermé le 15 août",
    href: "",
  });
  assert.deepEqual(payload.home.homeSections, { map: false, reviews: true, reassurance: true });
  assert.deepEqual(payload.home.heroImages, ["https://s3/s1/logo/hero-1.jpg"]);
});

test("an untouched legacy base64 logo is left out, an edited one blocks the save", () => {
  const legacyBaseline = buildOnlineStoreDefaults({
    ...store,
    logoUrl: "data:image/png;base64,AAA",
  });

  const untouched = clone(legacyBaseline);
  untouched.identity.name = "Ar Mor";
  const payload = buildOnlineStorePayload({ value: untouched, baseline: legacyBaseline });
  assert.ok(payload?.identity);
  assert.equal("logoUrl" in payload.identity, false);

  const edited = clone(legacyBaseline);
  edited.identity.faviconUrl = "data:image/png;base64,BBB";
  assert.equal(buildOnlineStorePayload({ value: edited, baseline: legacyBaseline }), null);
});

test("reordered legacy hero images block the save, untouched ones are left out", () => {
  const legacyBaseline = buildOnlineStoreDefaults({
    ...store,
    theme: {
      ...store.theme!,
      heroImages: ["data:image/jpeg;base64,AAA", "https://s3/s1/logo/b.jpg"],
    },
  });

  const untouched = clone(legacyBaseline);
  untouched.home.catalogBrowseMode = "products";
  const payload = buildOnlineStorePayload({ value: untouched, baseline: legacyBaseline });
  assert.ok(payload?.home);
  assert.equal("heroImages" in payload.home, false);

  const reordered = clone(legacyBaseline);
  reordered.home.heroImages.reverse();
  assert.equal(buildOnlineStorePayload({ value: reordered, baseline: legacyBaseline }), null);
});

test("replaced and unsaved images cover logos, favicon, hero photos and the share image", () => {
  const value = clone(baseline);
  value.identity.logoUrl = "https://s3/s1/logo/new-logo.png";
  value.identity.faviconUrl = "https://s3/s1/logo/favicon.png";
  value.home.heroImages = ["https://s3/s1/logo/hero-2.jpg"];
  value.seo.shareImageUrl = null;

  assert.deepEqual(listReplacedImages({ value, baseline }), {
    logos: ["https://s3/s1/logo/logo.png"],
    heroes: ["https://s3/s1/logo/hero-1.jpg", "https://s3/s1/logo/share.jpg"],
  });
  assert.deepEqual(listUnsavedImages({ value, baseline }), [
    "https://s3/s1/logo/new-logo.png",
    "https://s3/s1/logo/favicon.png",
    "https://s3/s1/logo/hero-2.jpg",
  ]);
});

test("structural equality ignores reference identity", () => {
  assert.equal(isSameValue({ a: [1, { b: null }] }, { a: [1, { b: null }] }), true);
  assert.equal(isSameValue({ a: 1 }, { a: 1, b: undefined }), true);
  assert.equal(isSameValue([1, 2], [2, 1]), false);
  assert.equal(isSameValue(null, undefined), false);
});

test("hex input accepts pasted values once six digits are there", () => {
  assert.equal(parseHexInput("#2563EB"), "#2563eb");
  assert.equal(parseHexInput("2563eb"), "#2563eb");
  assert.equal(parseHexInput("#25"), null);
});
