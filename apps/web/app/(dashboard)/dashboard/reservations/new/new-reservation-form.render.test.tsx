import "@/lib/testing/install-dom";
// Before the form, which builds the oRPC client with the `fetch` it finds.
import { controlledRpc } from "@/lib/testing/fake-fetch";

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { afterEach, beforeEach, mock, test } from "node:test";
import { pathToFileURL } from "node:url";
import { act } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";

import { toastManager } from "@louez/ui";
import { formatCurrency } from "@louez/utils";

import { PublicEnvProvider } from "@/components/shared/public-env-provider";
import { StoreProvider } from "@/contexts/store-context";
import { enableMockTimers, mount, pointerClick, settle, tick, typeInto } from "@/lib/testing/dom";
import { publicEnvSchema } from "@/lib/validators/validator.public-env";
import { EMPTY_WHATS_NEW_PROGRESS } from "@/lib/whats-new.progress";
import messages from "@/messages/en.json";

// A reservation created from the dashboard, for three days, with two custom
// items. The first one is edited after it was added: its card shows what it
// became, in its place, and the reservation is created with it.

// The customer picker walks text nodes with the browser's NodeFilter.
Object.assign(globalThis, { NodeFilter: window.NodeFilter });

const START = "2031-06-01T09:00:00.000Z";
const END = "2031-06-04T09:00:00.000Z";

const navigations: string[] = [];
mock.module("next/navigation", {
  namedExports: {
    useRouter: () => ({
      push: (href: string) => navigations.push(href),
      replace: (href: string) => navigations.push(href),
      refresh: () => {},
    }),
    // The period comes in the address, as from the product timeline.
    useSearchParams: () => new URLSearchParams({ startDate: START, endDate: END }),
  },
});
// Analytics are not sent: posthog's React entry is a directory the loader resolves
// through CommonJS, so it is mocked at the file it resolves to.
mock.module(pathToFileURL(createRequire(import.meta.url).resolve("posthog-js/react")).href, {
  namedExports: { usePostHog: () => ({ capture: () => {} }) },
});
// Server actions, which a test does not reach: the stock of the period, and what the
// customer picker's quick creation and the "new" badges would write.
mock.module("../actions", {
  namedExports: {
    getManualReservationAvailability: async () => ({
      success: true,
      availability: { products: [] },
    }),
  },
});
mock.module("@/app/(dashboard)/dashboard/customers/actions", {
  namedExports: {
    createCustomer: async () => ({}),
    updateCustomer: async () => ({}),
    updateCustomerSection: async () => ({}),
  },
});
mock.module("@/app/(dashboard)/dashboard/whats-new/actions", {
  namedExports: {
    dismissWhatsNewFeature: async () => {},
    markWhatsNewAnnouncementsSeen: async () => {},
  },
});

// Loaded once their server parts are mocked.
const load = async () => ({
  ...(await import("./new-reservation-form")),
  ...(await import("@/components/shared/whats-new-provider")),
});

const words = messages.dashboard.reservations.manualForm;
/** An amount as a card reads, its spaces plain. */
const money = (amount: number) => formatCurrency(amount).replace(/\s+/g, " ");
const ada = {
  id: "cus_form_ada",
  email: "ada@example.test",
  firstName: "Ada",
  lastName: "Lovelace",
  phone: null,
};

let unmount: (() => void) | null = null;
beforeEach(() => {
  enableMockTimers();
  navigations.length = 0;
  mock.method(toastManager, "add", () => "toast");
});
afterEach(() => {
  unmount?.();
  unmount = null;
  document.body.innerHTML = "";
  mock.restoreAll();
  mock.timers.reset();
});

const render = async () => {
  const requests = controlledRpc({ createManualReservation: { reservationId: "res_form_1" } });
  const { NewReservationForm, WhatsNewProvider } = await load();
  // No garbage collection timer outlives the test.
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { gcTime: Infinity },
    },
  });
  const view = mount(
    <PublicEnvProvider
      config={publicEnvSchema.parse({
        NEXT_PUBLIC_APP_URL: "https://app.louez.test",
        NEXT_PUBLIC_APP_DOMAIN: "louez.test",
      })}
    >
      <QueryClientProvider client={queryClient}>
        <NextIntlClientProvider locale="en" timeZone="Europe/Paris" messages={messages}>
          <StoreProvider
            role="owner"
            storeId="store_form"
            currency="EUR"
            storeSlug="form-test"
            storeName="Form test"
            timezone="Europe/Paris"
          >
            <WhatsNewProvider initialProgress={EMPTY_WHATS_NEW_PROGRESS}>
              <NewReservationForm
                onReservationCreated={() => {}}
                openReplaySource="direct"
                customers={[ada]}
                products={[]}
                tulipInsuranceMode="no_public"
                storeLocations={[]}
                currency="EUR"
                pricedAt={new Date("2031-05-01T00:00:00.000Z")}
              />
            </WhatsNewProvider>
          </StoreProvider>
        </NextIntlClientProvider>
      </QueryClientProvider>
    </PublicEnvProvider>,
  );
  unmount = view.unmount;
  await tick(500);
  return requests;
};

const buttons = (scope: ParentNode = document) => [
  ...scope.querySelectorAll<HTMLButtonElement>("button"),
];
const buttonByText = (label: string, scope: ParentNode = document) => {
  const found = buttons(scope).find((button) => button.textContent?.trim() === label);
  assert.ok(found, `the ${label} button`);
  return found;
};
const click = async (button: HTMLElement) => {
  act(() => button.click());
  await tick(500);
};
const dialog = () => {
  const found = document.querySelector<HTMLElement>('[role="dialog"]');
  assert.ok(found, "the dialog");
  return found;
};
/** A dialog field, by the label it reads under. */
const dialogField = (label: string) => {
  const found = [...dialog().querySelectorAll("label")].find((candidate) =>
    candidate.textContent?.trim().startsWith(label),
  );
  assert.ok(found, `the ${label} label`);
  const control = document.getElementById(found.htmlFor);
  assert.ok(control, `the ${label} field`);
  return control as HTMLInputElement;
};

const addCustomItem = async (name: string, total: string) => {
  await click(buttonByText(words.customItem.button));
  typeInto(dialogField(words.customItem.name), name);
  typeInto(dialogField(words.customItem.totalPrice), total);
  await click(buttonByText(words.customItem.addButton, dialog()));
};

/** The custom item cards, in order: each one's element, title, text and Edit button. */
const cards = () =>
  [...document.querySelectorAll<HTMLElement>("#section-products .border-dashed")].map((card) => ({
    element: card,
    title: card.querySelector("p")?.textContent,
    text: card.textContent?.replace(/\s+/g, " ") ?? "",
    edit: buttons(card).find((button) => button.textContent?.trim() === messages.common.edit),
  }));

test("a custom item edited after it was added shows what it became, and the reservation is created with it", async () => {
  const requests = await render();

  await addCustomItem("Sound console", "90");
  await addCustomItem("Stage", "60");
  assert.deepEqual(
    cards().map((card) => card.title),
    ["Sound console", "Stage"],
  );
  const first = cards()[0]?.element;

  // Edit the first one: its name, its total and its quantity.
  const edit = cards()[0]?.edit;
  assert.ok(edit, "the first card's Edit button");
  assert.equal(edit.getAttribute("aria-label"), "Edit Sound console");
  await click(edit);
  assert.equal(dialogField(words.customItem.name).value, "Sound console");
  assert.equal(dialogField(words.customItem.totalPrice).value, "90.00");
  typeInto(dialogField(words.customItem.name), "Sound console, two speakers");
  typeInto(dialogField(words.customItem.totalPrice), "150");
  typeInto(dialogField(words.customItem.quantity), "2");
  await click(buttonByText(messages.common.save, dialog()));

  // In its place, the same item (its card is kept, keyed by its id), with what it
  // became; the other one as it was.
  const [edited, stage] = cards();
  assert.deepEqual(
    cards().map((card) => card.title),
    ["Sound console, two speakers", "Stage"],
  );
  assert.equal(edited?.element, first);
  assert.ok(edited?.text.includes(`${money(25)}/${words.perDay}`), edited?.text);
  assert.ok(edited?.text.includes("2 × 3 days"), edited?.text);
  assert.ok(edited?.text.includes(money(150)), edited?.text);
  assert.ok(stage?.text.includes("1 × 3 days"), stage?.text);
  assert.ok(stage?.text.includes(money(60)), stage?.text);

  // The customer, then the creation.
  const picker = document.querySelector<HTMLElement>('[role="combobox"]');
  assert.ok(picker, "the customer picker");
  pointerClick(picker);
  await tick(500);
  const option = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((candidate) =>
    candidate.textContent?.includes("Ada Lovelace"),
  );
  assert.ok(option, "Ada in the list");
  pointerClick(option);
  await tick(500);
  await click(buttonByText(words.create));
  await settle();

  const creation = requests.find((request) => request.endpoint === "createManualReservation");
  assert.ok(creation, "the reservation is created");
  const sent = await creation.sent;
  const { json } = JSON.parse(sent.slice(sent.indexOf(" ") + 1)) as {
    json: { payload: { customerId: string; customItems: unknown[]; expectedTotal: number } };
  };
  assert.equal(json.payload.customerId, ada.id);
  assert.deepEqual(json.payload.customItems, [
    {
      name: "Sound console, two speakers",
      description: "",
      unitPrice: 25,
      deposit: 0,
      quantity: 2,
      pricingMode: "day",
    },
    { name: "Stage", description: "", unitPrice: 20, deposit: 0, quantity: 1, pricingMode: "day" },
  ]);
  assert.equal(json.payload.expectedTotal, 210);
  await tick(500);
  assert.deepEqual(navigations, ["/dashboard/reservations/res_form_1"]);
});
