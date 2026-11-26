import "@/lib/testing/install-dom";
import { setFetchHandler } from "@/lib/testing/fake-fetch";

import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { act, type ComponentProps } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";

import { PublicEnvProvider } from "@/components/shared/public-env-provider";
import { mount, pressKey, settle } from "@/lib/testing/dom";
import { publicEnvSchema } from "@/lib/validators/validator.public-env";
import messages from "@/messages/en.json";

import { StripePaymentRowActions } from "./stripe-payment-row-actions";

// A Stripe row's "⋯" menu: its button has a name, opens with the keyboard and closes with
// Escape; "Refund" is there, or disabled with why; the Stripe link says where it leads.

const words = messages.dashboard.reservations.payment.stripeRefund;

setFetchHandler(() => Promise.reject(new Error("no call expected")));

let unmount: (() => void) | null = null;
afterEach(() => {
  unmount?.();
  unmount = null;
});

type Props = ComponentProps<typeof StripePaymentRowActions>;
const render = (props: Partial<Props> = {}) => {
  const mounted = mount(
    <PublicEnvProvider
      config={publicEnvSchema.parse({
        NEXT_PUBLIC_APP_URL: "https://app.louez.test",
        NEXT_PUBLIC_APP_DOMAIN: "louez.test",
      })}
    >
      <NextIntlClientProvider locale="en" timeZone="Europe/Paris" messages={messages}>
        <QueryClientProvider client={new QueryClient()}>
          <StripePaymentRowActions
            paymentId="pay_menu"
            refund={{ state: "available" }}
            opensInStripe
            canOpenStripe
            dashboardKind="full"
            readOnly={false}
            onRefund={() => {}}
            {...props}
          />
        </QueryClientProvider>
      </NextIntlClientProvider>
    </PublicEnvProvider>,
  );
  unmount = mounted.unmount;
  return mounted.container;
};

const trigger = (container: HTMLElement) => {
  const button = container.querySelector<HTMLButtonElement>(
    `button[aria-label="${words.actions}"]`,
  );
  assert.ok(button, "the menu's button, by its name");
  return button;
};
const menuText = () =>
  document.querySelector('[role="menu"]')?.textContent?.replace(/\s+/g, " ") ?? null;

const openWithKeyboard = async (container: HTMLElement) => {
  const button = trigger(container);
  act(() => button.focus());
  // Enter on a focused button is its click, as a browser sends it.
  act(() => {
    button.dispatchEvent(
      new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }) as unknown as Event,
    );
    button.click();
  });
  await settle();
};

test("opens with the keyboard and closes with Escape", async () => {
  const container = render();
  await openWithKeyboard(container);
  const shown = menuText();
  assert.ok(shown?.includes(words.action), "Refund");
  assert.ok(shown?.includes(words.viewInStripe));
  const menu = document.querySelector<HTMLElement>('[role="menu"]');
  assert.ok(menu);
  pressKey(menu, "Escape");
  await settle();
  assert.equal(menuText(), null);
});

test("an Express account's link says it opens the account's Stripe dashboard", async () => {
  const container = render({ dashboardKind: "express" });
  await openWithKeyboard(container);
  assert.ok(menuText()?.includes(words.openStripeSpace));
  assert.ok(!menuText()?.includes(words.viewInStripe));
});

test("a refund that cannot be sent yet stays, disabled, with why", async () => {
  const container = render({ refund: { state: "disabled", reason: "disputed" } });
  await openWithKeyboard(container);
  const item = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((element) =>
    element.textContent?.includes(words.action),
  );
  assert.ok(item);
  assert.equal(item.getAttribute("aria-disabled"), "true");
  assert.ok(item.textContent?.includes(words.blocked.disputed));
});

test("read only: the button is disabled; nothing to offer: no button", () => {
  assert.equal(trigger(render({ readOnly: true })).disabled, true);
  unmount?.();
  const container = render({ refund: { state: "hidden" }, opensInStripe: false });
  assert.equal(container.querySelector("button"), null);
});
