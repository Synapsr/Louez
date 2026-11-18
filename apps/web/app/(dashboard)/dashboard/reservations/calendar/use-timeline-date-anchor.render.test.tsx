import "@/lib/testing/install-dom";

import assert from "node:assert/strict";
import { afterEach, before, mock, test } from "node:test";
import { Activity, act } from "react";
import { createRoot, type Root } from "react-dom/client";

// With Cache Components, Next keeps the reservations page mounted in a hidden
// <Activity> while a reservation is open, and reveals it on back navigation.
// The hidden scroller can come back at scrollLeft 0, so the reveal must
// re-centre on the `date` the view persisted on its way out, even though that
// date is the one it wrote itself.

mock.module("next/navigation", {
  namedExports: { useSearchParams: () => new URLSearchParams("date=2026-11-18") },
});

let useTimelineDateAnchor: typeof import("./use-timeline-date-anchor").useTimelineDateAnchor;

before(async () => {
  ({ useTimelineDateAnchor } = await import("./use-timeline-date-anchor"));
});

const NOVEMBER_18 = new Date(2026, 10, 18);

const goToDate = mock.fn((_date: Date, _behavior: ScrollBehavior) => {});
let persistVisibleDate = () => {};

const Timeline = ({ dateParam }: { dateParam: Date | null }) => {
  const anchor = useTimelineDateAnchor({
    view: "calendar",
    dateParam,
    visibleDate: NOVEMBER_18,
    goToDate,
  });
  persistVisibleDate = anchor.persistVisibleDate;
  return null;
};

let root: Root | null = null;

const render = (mode: "visible" | "hidden", dateParam: Date | null = NOVEMBER_18) => {
  act(() => {
    root ??= createRoot(document.createElement("div"));
    root.render(
      <Activity mode={mode}>
        <Timeline dateParam={dateParam} />
      </Activity>,
    );
  });
};

/** Lets the two animation frames the anchor waits for run. */
const nextFrames = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 20));
  });

const centredDates = () => goToDate.mock.calls.map((call) => call.arguments[0].getTime());

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  goToDate.mock.resetCalls();
});

test("the timeline centres on the URL date when it mounts", async () => {
  render("visible");
  await nextFrames();

  assert.deepEqual(centredDates(), [NOVEMBER_18.getTime()]);
});

test("the timeline does not re-centre on a date it just persisted while on screen", async () => {
  render("visible", null);
  await nextFrames();

  // The date the view writes comes back to it through the URL.
  persistVisibleDate();
  render("visible", NOVEMBER_18);
  await nextFrames();

  assert.deepEqual(centredDates(), []);
});

test("back from a reservation re-centres on the date the timeline persisted when leaving", async () => {
  render("visible");
  await nextFrames();
  goToDate.mock.resetCalls();

  // A click on a reservation bar persists the date, then Next hides the page.
  persistVisibleDate();
  render("hidden");
  await nextFrames();
  // Back navigation reveals it again.
  render("visible");
  await nextFrames();

  assert.deepEqual(centredDates(), [NOVEMBER_18.getTime()]);
});
