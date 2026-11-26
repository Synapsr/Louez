import "@/lib/testing/install-dom";

import assert from "node:assert/strict";
import { afterEach, beforeEach, mock, test } from "node:test";
import { act, useState } from "react";
import { NextIntlClientProvider } from "next-intl";

import type { PricingMode } from "@louez/types";
import { toastManager } from "@louez/ui";

import { enableMockTimers, mount, pressKey, tick, typeInto } from "@/lib/testing/dom";
import messages from "@/messages/en.json";

import type { CustomItem } from "../types";
import type { CustomItemValues } from "../utils/custom-item-form";
import { NewReservationCustomItemDialog } from "./new-reservation-custom-item-dialog";

// The custom item dialog of a new reservation, over a three-day rental: it
// adds an item, or opens on one already added to change it. Closing it saves
// nothing, and an edit is checked as an addition is.

const words = messages.dashboard.reservations.manualForm.customItem;
const START = new Date("2031-06-01T09:00:00.000Z");
const END = new Date("2031-06-04T09:00:00.000Z");
const DURATIONS: Record<PricingMode, number> = { hour: 72, day: 3, week: 1 };

const sound: CustomItem = {
  id: "custom-sound",
  name: "Vintage sound console",
  description: "With its cables",
  unitPrice: 100 / 3,
  deposit: 150,
  quantity: 1,
  pricingMode: "day",
  basePeriodMinutes: 1440,
};

interface Opened {
  saves: CustomItemValues[];
  closes: number;
  reopen: () => void;
}

const open = (item: CustomItem | null, options: { dated?: boolean } = {}) => {
  const opened: Opened = { saves: [], closes: 0, reopen: () => {} };
  const dated = options.dated ?? true;

  // As the reservation form holds it: each opening is a new session.
  const Harness = () => {
    const [dialog, setDialog] = useState({ open: true, session: 0 });
    opened.reopen = () => setDialog((current) => ({ open: true, session: current.session + 1 }));
    return (
      <NewReservationCustomItemDialog
        key={dialog.session}
        open={dialog.open}
        onOpenChange={(next) => {
          if (!next) opened.closes += 1;
          setDialog((current) => ({ ...current, open: next }));
        }}
        item={item}
        startDate={dated ? START : undefined}
        endDate={dated ? END : undefined}
        calculateDurationForMode={(_start, _end, mode) => DURATIONS[mode]}
        currency="EUR"
        onSave={(values) => opened.saves.push(values)}
      />
    );
  };

  const view = mount(
    <NextIntlClientProvider locale="en" timeZone="Europe/Paris" messages={messages}>
      <Harness />
    </NextIntlClientProvider>,
  );
  unmount = view.unmount;
  return opened;
};

const field = (name: string) => {
  const element = document.querySelector<HTMLInputElement>(
    `[role="dialog"] input[name="${name}"], [role="dialog"] textarea[name="${name}"]`,
  );
  assert.ok(element, `the ${name} field`);
  return element;
};
const button = (label: string) => {
  const found = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  assert.ok(found, `the ${label} button`);
  return found;
};
const dialogText = () =>
  document.querySelector('[role="dialog"]')?.textContent?.replace(/\s+/g, " ") ?? "";
const isOpen = () => document.querySelector('[role="dialog"]') !== null;
const press = async (label: string) => {
  act(() => button(label).click());
  await tick(500);
};

const recordToasts = () => {
  const toasts: Array<{ title?: unknown; type?: unknown }> = [];
  mock.method(toastManager, "add", (toast: { title?: unknown; type?: unknown }) => {
    toasts.push(toast);
    return "toast";
  });
  return toasts;
};

let unmount: (() => void) | null = null;
beforeEach(() => enableMockTimers());
afterEach(() => {
  unmount?.();
  unmount = null;
  document.body.innerHTML = "";
  mock.restoreAll();
  mock.timers.reset();
});

test("editing opens on the item's values, under its own title, with Save", async () => {
  open(sound);
  await tick(500);

  assert.ok(dialogText().includes(words.editDialogTitle));
  assert.ok(dialogText().includes(words.editDialogDescription));
  assert.equal(field("name").value, "Vintage sound console");
  assert.equal(field("description").value, "With its cables");
  assert.equal(field("quantity").value, "1");
  assert.equal(field("deposit").value, "150");
  assert.equal(field("totalPrice").value, "100.00");
  assert.equal(field("unitPrice").value, "33.33");
  assert.equal(
    document.querySelector("#custom-item-pricing-mode")?.textContent,
    messages.dashboard.reservations.manualForm.perDay,
  );
  assert.ok(dialogText().includes("3 days × 1 unit(s)"));
  button(messages.common.save);
});

test("Cancel and Escape close it and change nothing, and it opens again on the item", async () => {
  const opened = open(sound);
  await tick(500);
  typeInto(field("name"), "Something else");
  typeInto(field("totalPrice"), "999");
  await press(messages.common.cancel);

  assert.equal(opened.closes, 1);
  assert.deepEqual(opened.saves, []);
  assert.equal(sound.name, "Vintage sound console");

  act(() => opened.reopen());
  await tick(500);
  assert.equal(field("name").value, "Vintage sound console");
  assert.equal(field("totalPrice").value, "100.00");

  typeInto(field("name"), "Something else");
  const popup = document.querySelector<HTMLElement>('[role="dialog"]');
  assert.ok(popup);
  pressKey(popup, "Escape");
  await tick(500);
  assert.equal(opened.closes, 2);
  assert.deepEqual(opened.saves, []);
});

test("an edit saves its name, total and quantity, priced as when adding", async () => {
  const opened = open(sound);
  await tick(500);
  typeInto(field("name"), "Sound console, two speakers");
  typeInto(field("totalPrice"), "150");
  typeInto(field("quantity"), "2");
  await tick(0);
  // The total stays, its unit price follows the quantity.
  assert.equal(field("unitPrice").value, "25.00");
  assert.ok(dialogText().includes("3 days × 2 unit(s)"));
  await press(messages.common.save);

  assert.deepEqual(opened.saves, [
    {
      name: "Sound console, two speakers",
      description: "With its cables",
      unitPrice: 25,
      deposit: 150,
      quantity: 2,
      pricingMode: "day",
      basePeriodMinutes: 1440,
    },
  ]);
});

test("an edit that leaves the price alone keeps the exact unit price", async () => {
  const opened = open(sound);
  await tick(500);
  typeInto(field("name"), "Sound console");
  await press(messages.common.save);

  assert.equal(opened.saves.length, 1);
  assert.equal(opened.saves[0]?.unitPrice, 100 / 3);
  assert.equal(opened.saves[0]?.name, "Sound console");
});

test("an edit is checked as an addition is: a name, then a valid price", async () => {
  const toasts = recordToasts();
  const opened = open(sound);
  await tick(500);

  typeInto(field("name"), "   ");
  await press(messages.common.save);
  assert.deepEqual(opened.saves, []);
  assert.equal(toasts.at(-1)?.title, words.nameRequired);
  assert.equal(toasts.at(-1)?.type, "error");
  assert.ok(dialogText().includes(words.nameRequired), "under the name");

  typeInto(field("name"), "Sound console");
  typeInto(field("totalPrice"), "0");
  await press(messages.common.save);
  assert.deepEqual(opened.saves, []);
  assert.equal(toasts.at(-1)?.title, words.priceRequired);
  assert.ok(isOpen());
});

test("adding checks the same way, then adds", async () => {
  const toasts = recordToasts();
  const opened = open(null);
  await tick(500);

  assert.ok(dialogText().includes(words.dialogTitle));
  assert.equal(field("name").value, "");
  await press(words.addButton);
  assert.deepEqual(opened.saves, []);
  assert.equal(toasts.at(-1)?.title, words.priceRequired);
  assert.ok(dialogText().includes(words.nameRequired), "under the name");

  typeInto(field("name"), "Stage");
  typeInto(field("unitPrice"), "10");
  await tick(0);
  assert.equal(field("totalPrice").value, "30.00");
  await press(words.addButton);
  assert.deepEqual(opened.saves, [
    {
      name: "Stage",
      description: "",
      unitPrice: 10,
      deposit: 0,
      quantity: 1,
      pricingMode: "day",
      basePeriodMinutes: 1440,
    },
  ]);
});

test("adding without a period asks for a period and keeps the dialog open", async () => {
  const toasts = recordToasts();
  const opened = open(null, { dated: false });
  await tick(500);
  assert.ok(dialogText().includes(words.selectPeriodFirst));
  assert.equal(document.querySelector('[role="dialog"] input[name="totalPrice"]'), null);
  typeInto(field("name"), "Stage");
  await press(words.addButton);
  assert.deepEqual(opened.saves, []);
  assert.equal(toasts.at(-1)?.title, words.selectPeriodFirst);
  assert.ok(isOpen());
});

test("editing without a period asks for a period even when only the name changes", async () => {
  const toasts = recordToasts();
  const opened = open(sound, { dated: false });
  await tick(500);
  typeInto(field("name"), "Sound console");
  await press(messages.common.save);
  assert.deepEqual(opened.saves, []);
  assert.equal(toasts.at(-1)?.title, words.selectPeriodFirst);
  assert.ok(isOpen());
});
