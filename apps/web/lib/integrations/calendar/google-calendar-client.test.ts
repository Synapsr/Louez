import assert from "node:assert/strict";
import test from "node:test";

import {
  createGoogleCalendar,
  insertGoogleCalendarEvent,
} from "../providers/google-calendar/google-calendar-client";

test("creates Warsaw calendars and sends Warsaw event times and room location", async () => {
  const requests: Array<{ url: string; init: RequestInit | undefined }> = [];
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (input, init) => {
    const url = String(input);
    requests.push({ url, init });
    return url.endsWith("/calendars")
      ? Response.json({ id: "calendar-id", summary: "Rental eNStudios" })
      : Response.json({ id: "event-id" });
  };

  try {
    await createGoogleCalendar({
      accessToken: "test-token",
      summary: "Rental eNStudios",
    });
    await insertGoogleCalendarEvent({
      accessToken: "test-token",
      calendarId: "calendar-id",
      event: {
        summary: "R-123",
        description: "Test",
        location: "Studio, Meeting room",
        startDate: new Date("2026-11-20T09:00:00.000Z"),
        endDate: new Date("2026-11-20T12:00:00.000Z"),
        status: "confirmed",
        transparency: "transparent",
        visibility: "private",
        colorId: "10",
        url: "https://example.com/reservations/R-123",
      },
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  const calendarPayload = JSON.parse(String(requests[0].init?.body));
  assert.deepEqual(calendarPayload, {
    summary: "Rental eNStudios",
    timeZone: "Europe/Warsaw",
  });

  const eventPayload = JSON.parse(String(requests[1].init?.body));
  assert.equal(eventPayload.location, "Studio, Meeting room");
  assert.deepEqual(eventPayload.start, {
    dateTime: "2026-11-20T09:00:00.000Z",
    timeZone: "Europe/Warsaw",
  });
  assert.deepEqual(eventPayload.end, {
    dateTime: "2026-11-20T12:00:00.000Z",
    timeZone: "Europe/Warsaw",
  });
});
