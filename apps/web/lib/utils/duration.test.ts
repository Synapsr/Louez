import assert from "node:assert/strict";
import { test } from "node:test";

import { formatDateTime } from "@/lib/utils/duration";

test("formats the rental summary in the caller locale", () => {
  assert.deepEqual(
    formatDateTime(new Date("2026-08-27T09:00:00.000Z"), {
      includeYear: true,
      locale: "de-DE",
      timezone: "UTC",
    }),
    { date: "Do., 27. Aug. 2026", time: "09:00" },
  );
});
