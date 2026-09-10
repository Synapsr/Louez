import assert from "node:assert/strict";
import { test } from "node:test";
import { render } from "@react-email/render";

import { ReminderReturnEmail } from "./reminder-return";

const baseProps = {
  storeName: "VELO RIBINE",
  storeTimezone: "Europe/Paris",
  customerFirstName: "Tristan",
  reservationNumber: "R2604-9070",
  endDate: new Date("2026-07-13T15:00:00.000Z"),
  locale: "fr" as const,
};

test("renders the message the store owner added when sending by hand", async () => {
  const html = await render(
    ReminderReturnEmail({
      ...baseProps,
      additionalMessage: "Pensez à ramener le casque,\nil était dans le carton.",
    }),
  );

  assert.match(html, /Pensez à ramener le casque/);
  assert.match(html, /il était dans le carton\./);
});

test("renders nothing extra when there is no message", async () => {
  const withBlank = await render(ReminderReturnEmail({ ...baseProps, additionalMessage: "   " }));
  const without = await render(ReminderReturnEmail(baseProps));

  assert.equal(withBlank, without);
});
