import assert from "node:assert/strict";
import { test } from "node:test";

import {
  hasStoreContactChannels,
  resolveStoreContactChannels,
  toWhatsAppNumber,
} from "./util.store-contact";

const baseSettings = { reservationMode: "payment" as const, advanceNoticeMinutes: 1440 };

test("offers phone, email and the form by default when the store has both fields", () => {
  const channels = resolveStoreContactChannels({
    email: "hello@store.test",
    phone: "06 12 34 56 78",
    settings: baseSettings,
  });

  assert.deepEqual(channels, {
    layout: "full",
    primary: { kind: "phone", value: "06 12 34 56 78" },
    phone: "06 12 34 56 78",
    sms: false,
    whatsapp: null,
    email: "hello@store.test",
    form: { recipient: "hello@store.test", phoneField: "optional" },
    intro: null,
  });
});

test("hides a channel whose store field is empty even when toggled on", () => {
  const channels = resolveStoreContactChannels({
    email: "  ",
    phone: null,
    settings: {
      ...baseSettings,
      contact: {
        layout: "single",
        primaryChannel: "whatsapp",
        phone: true,
        sms: true,
        whatsapp: true,
        whatsappNumber: null,
        email: true,
        form: true,
        formRecipientEmail: null,
        formPhoneField: "required",
        intro: " ",
      },
    },
  });

  assert.equal(channels.phone, null);
  assert.equal(channels.sms, false);
  assert.equal(channels.whatsapp, null);
  assert.equal(channels.email, null);
  assert.equal(channels.form, null);
  assert.equal(channels.intro, null);
  assert.equal(channels.layout, "single");
  assert.equal(channels.primary, null);
  assert.equal(hasStoreContactChannels(channels), false);
});

test("uses the dedicated WhatsApp number and form recipient over the store fields", () => {
  const channels = resolveStoreContactChannels({
    email: "hello@store.test",
    phone: "+33 6 12 34 56 78",
    settings: {
      ...baseSettings,
      contact: {
        layout: "single",
        primaryChannel: "whatsapp",
        phone: false,
        sms: true,
        whatsapp: true,
        whatsappNumber: "+32 470 12 34 56",
        email: false,
        form: true,
        formRecipientEmail: "contact@store.test",
        formPhoneField: "hidden",
        intro: "Écrivez-nous.",
      },
    },
  });

  assert.equal(channels.phone, null);
  assert.equal(channels.sms, false);
  assert.equal(channels.whatsapp, "32470123456");
  assert.deepEqual(channels.primary, { kind: "whatsapp", value: "32470123456" });
  assert.equal(channels.email, null);
  assert.deepEqual(channels.form, { recipient: "contact@store.test", phoneField: "hidden" });
  assert.equal(channels.intro, "Écrivez-nous.");
});

test("falls back to the store phone for WhatsApp", () => {
  const channels = resolveStoreContactChannels({
    email: null,
    phone: "06 12 34 56 78",
    settings: {
      ...baseSettings,
      contact: {
        layout: "message",
        primaryChannel: "email",
        phone: true,
        sms: true,
        whatsapp: true,
        whatsappNumber: "",
        email: true,
        form: false,
        formRecipientEmail: null,
        formPhoneField: "optional",
        intro: null,
      },
    },
  });

  assert.equal(channels.sms, true);
  assert.equal(channels.whatsapp, "0612345678");
  assert.equal(channels.form, null);
  assert.equal(channels.layout, "message");
  assert.equal(channels.primary, null);
});

test("toWhatsAppNumber keeps digits only and rejects numbers that are too short", () => {
  assert.equal(toWhatsAppNumber("+33 (0)6-12.34 56 78"), "330612345678");
  assert.equal(toWhatsAppNumber("12 34"), null);
});
