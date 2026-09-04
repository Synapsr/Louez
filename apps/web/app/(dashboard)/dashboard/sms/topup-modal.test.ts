import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { SMS_TOPUP_PACKAGES } from "@/lib/sms/sms-topup.constants";

test("keeps the SMS top-up modal out of the server plan module graph", async () => {
  const source = await readFile(new URL("./topup-modal.tsx", import.meta.url), "utf8");

  assert.doesNotMatch(
    source,
    /from ['"]@\/lib\/plans['"]/,
    "client code must not import server plan config",
  );
  assert.deepEqual(SMS_TOPUP_PACKAGES, [50, 100, 250, 500]);
});
