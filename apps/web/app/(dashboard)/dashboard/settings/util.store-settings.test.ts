import assert from "node:assert/strict";
import { test } from "node:test";

import type { StoreSettings } from "@louez/types";

import {
  type CompanySettingsInput,
  type ReservationRulesInput,
  buildCompanySettingsUpdate,
  buildReservationRulesUpdate,
} from "./util.store-settings";

const companyInput = {
  country: "BE",
  currency: "EUR",
  billingAddressSameAsStore: false,
  billingAddress: "12 rue de la Gare",
  billingCity: "Namur",
  billingPostalCode: "5000",
  billingCountry: "BE",
} satisfies CompanySettingsInput;

const reservationRulesInput = {
  reservationMode: "request",
  pendingBlocksAvailability: false,
  automaticExtensions: false,
  maxExtensionDays: 7,
  onlinePaymentDepositPercentage: 50,
  minRentalMinutes: 120,
  maxRentalMinutes: 20160,
  advanceNoticeMinutes: 2880,
  turnoverBufferMinutes: 30,
  requireCustomerAddress: true,
} satisfies ReservationRulesInput;

/** A store that has been through every settings page once. */
const currentSettings = {
  reservationMode: "payment",
  pendingBlocksAvailability: true,
  automaticExtensions: true,
  maxExtensionDays: null,
  onlinePaymentDepositPercentage: 100,
  minRentalMinutes: 60,
  maxRentalMinutes: null,
  advanceNoticeMinutes: 1440,
  turnoverBufferMinutes: 0,
  requireCustomerAddress: false,
  country: "FR",
  timezone: "Europe/Paris",
  currency: "EUR",
  billingAddress: { useSameAsStore: true },
  locale: "fr",
  delivery: {
    enabled: true,
    multiLocationEnabled: true,
    mode: "required",
    pricePerKm: 2.5,
    minimumFee: 15,
    maximumDistance: 40,
    freeDeliveryThreshold: 200,
    minimumOrderAmountForDelivery: 50,
  },
  tax: { enabled: true, defaultRate: 20, displayMode: "inclusive", taxLabel: "TVA" },
  contact: {
    layout: "single",
    primaryChannel: "whatsapp",
    phone: true,
    sms: false,
    whatsapp: true,
    whatsappNumber: "+33612345678",
    email: true,
    form: false,
    formRecipientEmail: null,
    formPhoneField: "required",
    intro: "Une question avant de réserver ?",
  },
  seo: { googleSiteVerification: "abc123" },
  social: { instagram: "https://instagram.com/location-pro", website: null },
  footerNote: "SIRET 123 456 789 00012",
  inspection: {
    enabled: true,
    mode: "required",
    requireCustomerSignature: true,
    autoGeneratePdf: true,
    maxPhotosPerItem: 8,
  },
  integrationData: {
    states: {
      "google-calendar": { enabled: true },
    },
  },
} satisfies StoreSettings;

/** Branches neither page owns; both builders must hand them back byte for byte. */
const PRESERVED_KEYS = [
  "delivery",
  "tax",
  "contact",
  "seo",
  "social",
  "footerNote",
  "locale",
  "inspection",
  "integrationData",
] as const;

test("company settings update preserves the settings branches it does not own", () => {
  const nextSettings = buildCompanySettingsUpdate(currentSettings, companyInput);

  for (const key of PRESERVED_KEYS) {
    assert.deepEqual(nextSettings[key], currentSettings[key], key);
  }
});

test("company settings update sets the timezone from the country", () => {
  const nextSettings = buildCompanySettingsUpdate(currentSettings, companyInput);

  assert.equal(nextSettings.country, "BE");
  assert.equal(nextSettings.timezone, "Europe/Brussels");
  assert.equal(nextSettings.currency, "EUR");
  assert.deepEqual(nextSettings.billingAddress, {
    useSameAsStore: false,
    address: "12 rue de la Gare",
    city: "Namur",
    postalCode: "5000",
    country: "BE",
  });
});

test("company settings update drops the custom billing fields when the store address is reused", () => {
  const nextSettings = buildCompanySettingsUpdate(currentSettings, {
    ...companyInput,
    billingAddressSameAsStore: true,
  });

  assert.deepEqual(nextSettings.billingAddress, {
    useSameAsStore: true,
    address: undefined,
    city: undefined,
    postalCode: undefined,
    country: undefined,
  });
});

test("company settings update keeps the booking rules untouched", () => {
  const nextSettings = buildCompanySettingsUpdate(currentSettings, companyInput);

  assert.equal(nextSettings.reservationMode, "payment");
  assert.equal(nextSettings.pendingBlocksAvailability, true);
  assert.equal(nextSettings.minRentalMinutes, 60);
  assert.equal(nextSettings.advanceNoticeMinutes, 1440);
  assert.equal(nextSettings.automaticExtensions, true);
});

test("booking rules update preserves the settings branches it does not own", () => {
  const nextSettings = buildReservationRulesUpdate(currentSettings, reservationRulesInput);

  for (const key of PRESERVED_KEYS) {
    assert.deepEqual(nextSettings[key], currentSettings[key], key);
  }
});

test("booking rules update keeps the company keys untouched", () => {
  const nextSettings = buildReservationRulesUpdate(currentSettings, reservationRulesInput);

  assert.equal(nextSettings.country, "FR");
  assert.equal(nextSettings.timezone, "Europe/Paris");
  assert.equal(nextSettings.currency, "EUR");
  assert.deepEqual(nextSettings.billingAddress, { useSameAsStore: true });
});

test("booking rules update sets every rule", () => {
  const nextSettings = buildReservationRulesUpdate(currentSettings, reservationRulesInput);

  assert.equal(nextSettings.reservationMode, "request");
  assert.equal(nextSettings.pendingBlocksAvailability, false);
  assert.equal(nextSettings.automaticExtensions, false);
  assert.equal(nextSettings.maxExtensionDays, 7);
  assert.equal(nextSettings.onlinePaymentDepositPercentage, 50);
  assert.equal(nextSettings.minRentalMinutes, 120);
  assert.equal(nextSettings.maxRentalMinutes, 20160);
  assert.equal(nextSettings.advanceNoticeMinutes, 2880);
  assert.equal(nextSettings.turnoverBufferMinutes, 30);
  assert.equal(nextSettings.requireCustomerAddress, true);
});

test("both builders fill the required keys for a store without settings", () => {
  const companySettings = buildCompanySettingsUpdate(null, companyInput);
  assert.equal(companySettings.reservationMode, "payment");
  assert.equal(companySettings.advanceNoticeMinutes, 1440);
  assert.equal(companySettings.timezone, "Europe/Brussels");

  const reservationRules = buildReservationRulesUpdate(undefined, reservationRulesInput);
  assert.equal(reservationRules.reservationMode, "request");
  assert.equal(reservationRules.country, undefined);
});
