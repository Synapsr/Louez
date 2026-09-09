import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCalendarLinks } from "./util.calendar-links";

test("prefills provider events with exact UTC dates and encoded text", () => {
  const links = buildCalendarLinks({
    title: "Vélo & randonnée",
    description: "2 × vélo\nCasque",
    location: "Paris, France",
    startDate: "2026-09-10T09:00:00+02:00",
    endDate: "2026-09-12T12:00:00+02:00",
    timezone: "Europe/Paris",
  });
  const google = new URL(links.google);
  assert.equal(google.searchParams.get("dates"), "20260910T070000Z/20260912T100000Z");
  assert.equal(google.searchParams.get("text"), "Vélo & randonnée");
  assert.equal(google.searchParams.get("details"), "2 × vélo\nCasque");
  assert.equal(google.searchParams.get("stz"), "Europe/Paris");
  for (const href of [links.outlook, links.office]) {
    const url = new URL(href);
    assert.equal(url.searchParams.get("startdt"), "2026-09-10T07:00:00.000Z");
    assert.equal(url.searchParams.get("enddt"), "2026-09-12T10:00:00.000Z");
    assert.equal(url.searchParams.get("subject"), "Vélo & randonnée");
    assert.equal(url.searchParams.get("location"), "Paris, France");
  }
});
