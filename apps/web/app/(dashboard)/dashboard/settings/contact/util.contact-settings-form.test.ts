import assert from "node:assert/strict";
import { test } from "node:test";

import { buildContactSettingsDefaults } from "./util.contact-settings-form";

const store = {
  name: "Ar Mor Location",
  slug: "ar-mor-location",
  email: "hello@armor.test",
  phone: "02 98 00 00 00",
  address: "1 quai, Concarneau",
  settings: { reservationMode: "payment" as const, advanceNoticeMinutes: 1440 },
};

test("defaults come from the shared contact defaults when nothing was saved", () => {
  assert.deepEqual(buildContactSettingsDefaults(store), {
    layout: "full",
    primaryChannel: "phone",
    phone: true,
    sms: false,
    whatsapp: false,
    whatsappNumber: "",
    email: true,
    form: true,
    formRecipientEmail: "",
    formPhoneField: "optional",
    intro: "",
  });
});

test("saved settings win over the defaults and nulls read as empty strings", () => {
  const defaults = buildContactSettingsDefaults({
    ...store,
    settings: {
      ...store.settings,
      contact: {
        layout: "single",
        primaryChannel: "whatsapp",
        phone: false,
        sms: false,
        whatsapp: true,
        whatsappNumber: "+33 6 00 00 00 00",
        email: true,
        form: false,
        formRecipientEmail: null,
        formPhoneField: "required",
        intro: "Bonjour",
      },
    },
  });

  assert.equal(defaults.layout, "single");
  assert.equal(defaults.primaryChannel, "whatsapp");
  assert.equal(defaults.phone, false);
  assert.equal(defaults.whatsappNumber, "+33 6 00 00 00 00");
  assert.equal(defaults.formRecipientEmail, "");
  assert.equal(defaults.formPhoneField, "required");
  assert.equal(defaults.intro, "Bonjour");
});
