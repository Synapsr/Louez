import assert from "node:assert/strict";
import test from "node:test";

test("logs the email link from rendered HTML when a dev recipient is blocked", async () => {
  process.env.NODE_ENV = "test";
  process.env.SMTP_HOST = "smtp.example.test";
  process.env.SMTP_USER = "test";
  process.env.SMTP_PASSWORD = "test";
  process.env.SMTP_FROM = "Louez <noreply@example.test>";
  process.env.DEV_EMAIL_ALLOWLIST = "";

  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (...values: unknown[]) => {
    logs.push(values.map(String).join(" "));
  };

  try {
    const { sendEmail } = await import("./send");
    await sendEmail({
      to: "blocked@example.test",
      subject: "Delete account",
      html: '<a href="https://louez.localify/account/delete/confirm#token=test-token">Continue</a>',
    });
  } finally {
    console.log = originalLog;
  }

  assert.ok(
    logs.includes(
      "[DEV] Email link: https://louez.localify/account/delete/confirm#token=test-token",
    ),
  );
});

test("never sends to an undeliverable reserved domain (demo stores' addresses)", async () => {
  process.env.NODE_ENV = "test";
  process.env.SMTP_HOST = "smtp.example.test";
  process.env.SMTP_USER = "test";
  process.env.SMTP_PASSWORD = "test";
  process.env.SMTP_FROM = "Louez <noreply@example.test>";
  process.env.DEV_EMAIL_ALLOWLIST = "visiteur-abc@demo.example";

  const { sendEmail, isUndeliverableEmailAddress } = await import("./send");
  assert.equal(isUndeliverableEmailAddress("visiteur-abc@demo.example"), true);
  assert.equal(isUndeliverableEmailAddress("Alex <alex@shop.invalid>"), true);
  assert.equal(isUndeliverableEmailAddress("owner@louez.io"), false);
  assert.equal(isUndeliverableEmailAddress("someone@example.com"), false);

  // Allow-listed, so only the reserved-domain rule can stop it before the transport.
  const result = await sendEmail({
    to: "visiteur-abc@demo.example",
    subject: "x",
    html: "<p>x</p>",
  });
  assert.equal(result.success, true);
  assert.match(String(result.messageId), /^email-undeliverable-/);
});
