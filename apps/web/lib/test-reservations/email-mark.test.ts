import assert from "node:assert/strict";
import { test } from "node:test";

import { markTestReservationEmail, runWithTestEmailMark } from "./email-mark";

const email = { to: "owner@example.test", subject: "Confirmation", html: "<body><p>Hi</p></body>" };
const mark = {
  subjectPrefix: "[Test] ",
  banner: "Rien n'a été encaissé.",
  recipient: "member@example.test",
};

test("an e-mail sent outside a test reservation's send goes as it is", () => {
  assert.deepEqual(markTestReservationEmail(email), email);
});

test("an e-mail sent inside it is marked, also after an await", async () => {
  const marked = await runWithTestEmailMark(mark, async () => {
    await new Promise((resolve) => setTimeout(resolve, 1));
    return markTestReservationEmail(email);
  });
  assert.equal(marked.subject, "[Test] Confirmation");
  assert.match(marked.html, /Rien n'a été encaissé\./);
  // Only to the member who started the test, whoever it was addressed to.
  assert.equal(marked.to, mark.recipient);
  // The mark ends with the send.
  assert.deepEqual(markTestReservationEmail(email), email);
});
