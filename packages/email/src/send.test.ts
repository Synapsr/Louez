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
