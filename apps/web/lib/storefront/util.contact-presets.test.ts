import assert from "node:assert/strict";
import { test } from "node:test";

import { applyContactPreset, detectContactPreset } from "./util.contact-presets";

const custom = {
  layout: "full" as const,
  primaryChannel: "phone" as const,
  phone: true,
  sms: false,
  whatsapp: false,
  email: true,
  form: true,
  intro: "Bonjour",
};

test("applying a preset sets the layout and the toggles it owns, nothing else", () => {
  const message = applyContactPreset(custom, "message");
  assert.equal(message.layout, "message");
  assert.equal(message.phone, false);
  assert.equal(message.email, true);
  assert.equal(message.form, true);
  assert.equal(message.intro, "Bonjour");

  const single = applyContactPreset(custom, "single", "whatsapp");
  assert.deepEqual(
    { ...single, intro: undefined },
    {
      layout: "single",
      primaryChannel: "whatsapp",
      phone: false,
      sms: false,
      whatsapp: true,
      email: false,
      form: false,
      intro: undefined,
    },
  );
});

test("a preset is detected only while its toggles are untouched", () => {
  assert.equal(detectContactPreset(custom), null);
  assert.equal(detectContactPreset(applyContactPreset(custom, "full")), "full");
  assert.equal(detectContactPreset(applyContactPreset(custom, "single", "email")), "single");
  assert.equal(
    detectContactPreset({ ...applyContactPreset(custom, "single", "email"), form: true }),
    null,
  );
});
