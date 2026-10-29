import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import * as nodeModule from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { pathToFileURL } from "node:url";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";
import React, { type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { PublicEnvProvider } from "@/components/shared/public-env-provider";
import type { Plan } from "@/lib/plans.shared";

import type { SubscriptionManagementProps } from "./subscription-management";
import { publicEnvSchema } from "@/lib/validators/validator.public-env";
import messages from "@/messages/fr.json";

// The plan page's grid and pay-as-you-go preview (plans-for-new-stores L7, L8). A store
// the billing service bills sees the service's words for pay-as-you-go, never Louez's
// pricing, and a link to its billing settings. An old store sees what it saw before,
// except that pay-as-you-go is its current plan when it is on it. The plan change dialog
// says what Stripe's preview answers, the amount charged now or the day the new plan
// starts, while it loads and when it fails, and why the last confirmation failed. A plan
// change waiting for the end of the paid period shows on the page, with the button to
// keep the current plan. The server actions and the router are stubs; the label is a
// fake one.

// tsx loads the shared UI package through CommonJS with the classic JSX runtime.
Object.assign(globalThis, { React });

const directory = mkdtempSync(join(tmpdir(), "louez-plan-page-"));
after(() => rmSync(directory, { recursive: true }));
const stub = (name: string, source: string) => {
  const path = join(directory, `${name}.cjs`);
  writeFileSync(path, source);
  return pathToFileURL(path).href;
};
const actionsUrl = stub(
  "actions",
  [
    "createCheckoutSession",
    "changeSubscriptionPlan",
    "previewPlanChange",
    "keepCurrentPlan",
    "cancelSubscription",
    "openCustomerPortal",
    "reactivateSubscription",
    "switchToPayAsYouGo",
  ]
    .map((name) => `exports.${name} = async () => ({});`)
    .join("\n"),
);
const navigationUrl = stub(
  "navigation",
  "exports.useRouter = () => ({ push() {}, replace() {}, refresh() {} });",
);
Reflect.get(
  nodeModule,
  "registerHooks",
)({
  resolve(
    specifier: string,
    context: { parentURL?: string },
    next: (specifier: string, context: unknown) => unknown,
  ) {
    const fromThisFolder = String(context.parentURL).includes("/dashboard/subscription/");
    if (fromThisFolder && specifier === "./actions") return { url: actionsUrl, shortCircuit: true };
    // The plan change preview's query factory imports the actions by their path.
    if (specifier === "@/app/(dashboard)/dashboard/subscription/actions")
      return { url: actionsUrl, shortCircuit: true };
    if (fromThisFolder && specifier === "next/navigation")
      return { url: navigationUrl, shortCircuit: true };
    return next(specifier, context);
  },
});

const OFFER_LABEL = "Offre de test";
const PERIOD_END = new Date("2026-11-28T10:00:00Z");
const features: Plan["features"] = {
  maxProducts: 50,
  maxReservationsPerMonth: 100,
  maxCustomers: 500,
  maxCollaborators: 2,
  maxSmsPerMonth: 50,
  aiCreditsPerMonth: 0,
  onlinePayment: true,
  analytics: true,
  emailNotifications: true,
  whiteLabel: false,
  customDomain: false,
  prioritySupport: false,
  customerPortal: true,
  reviewBooster: true,
  aiAdvisor: true,
  aiPhone: true,
  apiAccess: false,
  phoneSupport: false,
  dedicatedManager: false,
};
const plan = (slug: string, name: string): Plan => ({
  slug,
  name,
  description: `${name} description`,
  price: 10,
  features,
  stripePrices: {
    eur: { monthly: `price_${slug}_month`, yearly: `price_${slug}_year` },
    usd: { monthly: `price_${slug}_month_usd`, yearly: `price_${slug}_year_usd` },
  },
});
const PLANS = [plan("pro", "Pro"), plan("ultra", "Ultra")];
const USAGE = {
  products: 3,
  reservations: 4,
  customers: 5,
  collaborators: 1,
  collaboratorsLimit: null,
  sms: 0,
  smsLimit: null,
};
const PRO_SUBSCRIPTION = {
  id: "sub_row",
  planSlug: "pro",
  status: "active" as const,
  currentPeriodEnd: new Date("2026-11-28T10:00:00Z"),
  cancelAtPeriodEnd: false,
  stripeSubscriptionId: "sub_test",
  stripeCustomerId: "cus_test",
  plan: PLANS[0],
  billingInterval: "monthly" as const,
  billingCurrency: "eur" as const,
};
const PAYG_ROW = {
  ...PRO_SUBSCRIPTION,
  planSlug: "pay_as_you_go",
  stripeSubscriptionId: null,
  plan: undefined,
  billingInterval: null,
  billingCurrency: null,
};

describe("plan page views", () => {
  let views: {
    management: typeof import("./subscription-management");
    preview: typeof import("./pay-as-you-go-preview");
    planChange: typeof import("./plan-change-summary");
  };
  before(async () => {
    views = {
      management: await import("./subscription-management"),
      preview: await import("./pay-as-you-go-preview"),
      planChange: await import("./plan-change-summary"),
    };
  });

  const render = (node: ReactNode) =>
    renderToStaticMarkup(
      <PublicEnvProvider
        config={publicEnvSchema.parse({
          NEXT_PUBLIC_APP_URL: "https://app.louez.io",
          NEXT_PUBLIC_APP_DOMAIN: "louez.io",
        })}
      >
        <NextIntlClientProvider locale="fr" timeZone="Europe/Paris" messages={messages}>
          <QueryClientProvider client={new QueryClient()}>{node}</QueryClientProvider>
        </NextIntlClientProvider>
      </PublicEnvProvider>,
    )
      .replace(/\s|&nbsp;/g, " ")
      .replace(/&#x27;/g, "'");

  const grid = (props: Partial<SubscriptionManagementProps>) =>
    render(
      <views.management.SubscriptionManagement
        subscription={null}
        plans={PLANS}
        canAccessBillingPortal={false}
        usage={USAGE}
        {...props}
      />,
    );

  /** Each plan card's button, as `label:enabled` or `label:disabled`. */
  const PLAN_LABELS = new Set(["Choisir ce plan", "Plan actuel"]);
  const planButtons = (html: string) =>
    html
      .split("<button")
      .slice(1)
      .flatMap((chunk) => {
        const tag = chunk.slice(0, chunk.indexOf(">"));
        const label = chunk
          .slice(tag.length + 1, chunk.indexOf("</button>"))
          .replace(/<[^>]*>/g, "")
          .trim();
        if (!PLAN_LABELS.has(label)) return [];
        return [`${label}:${/\sdisabled=""|data-disabled/.test(tag) ? "disabled" : "enabled"}`];
      });

  test("a new store on pay-as-you-go sees the service's offer, not Louez's pricing", () => {
    const html = grid({
      offerLabel: OFFER_LABEL,
      billingSettingsHref: "/dashboard/settings/billing",
    });
    assert.ok(html.includes("Votre offre Louez"));
    assert.ok(html.includes(OFFER_LABEL));
    assert.match(html, /href="\/dashboard\/settings\/billing"[^>]*>.*Gérer la facturation/);
    for (const legacy of [
      "À la location",
      "Passer au paiement à la location",
      "Retour à l'usage",
    ]) {
      assert.ok(!html.includes(legacy), legacy);
    }
    // The current plan is pay-as-you-go, not the first plan on sale.
    assert.ok(html.includes("Pay as you go"));
    assert.deepEqual(planButtons(html), ["Choisir ce plan:enabled", "Choisir ce plan:enabled"]);
  });

  test("before any policy, the card says the offer is coming; without access, no link", () => {
    const html = grid({ offerLabel: null, subscription: PAYG_ROW });
    assert.ok(html.includes("Votre offre s'affichera ici"));
    assert.ok(!html.includes("/dashboard/settings/billing"));
    assert.ok(!html.includes("À la location"));
  });

  test("on a live plan, the other plan stays clickable to change it, the current one does not", () => {
    const html = grid({
      subscription: PRO_SUBSCRIPTION,
      hasLiveSubscription: true,
      offerLabel: OFFER_LABEL,
    });
    assert.deepEqual(planButtons(html), ["Plan actuel:disabled", "Choisir ce plan:enabled"]);
    assert.ok(html.includes("Annuler l'abonnement"));
  });

  test("an old pay-as-you-go store sees pay-as-you-go as its current plan, and the way back", () => {
    // Before the plans for new stores, this card showed the first plan on sale, Pro, with
    // its price: a leftover of the free plan, which used to come first.
    const html = grid({ subscription: PAYG_ROW, showBackToPayAsYouGo: true });
    assert.ok(html.includes("Pay as you go"));
    assert.ok(html.includes("À la location"));
    assert.ok(html.includes("Retour à l'usage"));
    for (const absent of ["Votre offre Louez", "Passer au paiement à la location"]) {
      assert.ok(!html.includes(absent), absent);
    }
    assert.deepEqual(planButtons(html), ["Choisir ce plan:enabled", "Choisir ce plan:enabled"]);
  });

  test("an old store on a plan keeps its price and the switch to pay-as-you-go", () => {
    const html = grid({ subscription: PRO_SUBSCRIPTION, hasLiveSubscription: true });
    assert.ok(html.includes("Passer au paiement à la location"));
    assert.ok(html.includes("Annuler l'abonnement"));
    for (const absent of ["Votre offre Louez", "À la location", "Pay as you go"]) {
      assert.ok(!html.includes(absent), absent);
    }
    assert.deepEqual(planButtons(html), ["Plan actuel:disabled", "Choisir ce plan:enabled"]);
  });

  /** The plan change dialog's body, Pro to Ultra monthly, with what the preview answered. */
  const summary = (
    preview: import("./util.plan-change-preview").PlanChangePreviewView,
    error?: string,
  ) =>
    render(
      <views.planChange.PlanChangeSummary
        currentPlanName="Pro"
        newPlanName="Ultra"
        newPlanPrice="10€"
        interval="monthly"
        preview={preview}
        error={error}
      />,
    );
  const NOTES = [
    "Calcul du montant à payer…",
    "Montant prélevé aujourd’hui",
    "Rien à payer aujourd’hui",
  ];

  test("the plan change dialog says what Stripe charges now, under the plans", () => {
    const now = summary({ status: "now", amountDue: 13200, currency: "eur" });
    const note =
      "Montant prélevé aujourd’hui : 132,00 €. Votre nouveau plan commence tout de suite.";
    assert.ok(now.includes("10€ HT / mois"));
    assert.ok(now.includes(note), now);
    assert.ok(now.indexOf(note) > now.indexOf("10€ HT / mois"));
    assert.ok(!now.includes('role="alert"'));

    // Nothing to pay, as during a trial.
    const free = summary({ status: "now", amountDue: 0, currency: "eur" });
    assert.ok(
      free.includes("Rien à payer aujourd’hui. Votre nouveau plan commence tout de suite."),
    );
    assert.ok(!free.includes("Montant prélevé"));
  });

  test("a change that would leave a credit says the day it starts, and that the plan stays until then", () => {
    const html = summary({ status: "at_period_end", at: PERIOD_END });
    assert.ok(
      html.includes(
        "Rien à payer aujourd’hui. Votre nouveau plan commence le 28 novembre 2026. D’ici là, vous gardez votre plan actuel.",
      ),
      html,
    );
    assert.ok(!html.includes("tout de suite"));
  });

  test("while Stripe previews the change, the dialog says so; a failed preview shows its error and no note", () => {
    const loading = summary({ status: "loading" });
    assert.ok(loading.includes("Calcul du montant à payer…"));
    assert.ok(loading.includes('role="status"'));
    assert.ok(!loading.includes("Rien à payer") && !loading.includes("Montant prélevé"));

    const failed = summary({ status: "error", error: "errors.generic" }, messages.errors.generic);
    assert.ok(failed.includes(messages.errors.generic));
    for (const note of NOTES) assert.ok(!failed.includes(note), note);
    // A checkout answer, for a subscription Stripe had ended, shows no note either.
    const checkout = summary({ status: "checkout" });
    for (const note of NOTES) assert.ok(!checkout.includes(note), note);
  });

  test("a refused plan change shows its reason in the dialog, under the note", () => {
    const reason = messages.errors.planPaymentFailed;
    const html = summary({ status: "now", amountDue: 13200, currency: "eur" }, reason);
    assert.ok(html.includes(reason));
    assert.ok(html.indexOf(reason) > html.indexOf("Montant prélevé aujourd’hui"));

    // The dialog opens only after a click, which a static render cannot make: the page's
    // source is checked instead, so that its dialog keeps this body, the preview, the
    // reason, and a confirmation that waits for the preview.
    const page = readFileSync(new URL("./subscription-management.tsx", import.meta.url), "utf8");
    const opens = page.indexOf("open={pendingChange !== null}");
    assert.ok(opens > 0);
    const dialog = page.slice(opens, page.indexOf("</Dialog>", opens));
    assert.match(dialog, /<PlanChangeSummary\b[\s\S]*?\bpreview=\{changePreview\}[\s\S]*?\/>/);
    assert.match(
      dialog,
      /error=\{\s*changePreview\.status === 'error'\s*\? errorText\(changePreview\.error\)\s*: changeError && errorText\(changeError\)\s*\}/,
    );
    assert.match(dialog, /disabled=\{loading !== null \|\| !canConfirmPlanChange\(changePreview\)\}/);
    assert.match(
      page,
      /useQuery\(\s*subscriptionQueries\.planChangePreview\(\s*pendingChange && \{/,
    );
  });

  test("a plan change waiting for the end of the paid period shows on the page, with the button to keep the plan", () => {
    const pending = grid({
      subscription: {
        ...PRO_SUBSCRIPTION,
        pendingPlanChange: { planSlug: "ultra", interval: "yearly", at: PERIOD_END },
      },
      hasLiveSubscription: true,
    });
    assert.ok(pending.includes("Pro jusqu’au 28 novembre 2026, puis Ultra annuel."), pending);
    assert.match(pending, /<button[^>]*><span[^>]*>Garder Pro<\/span><\/button>/);

    const none = grid({ subscription: { ...PRO_SUBSCRIPTION, pendingPlanChange: null }, hasLiveSubscription: true });
    assert.ok(!none.includes("puis Ultra"));
    assert.ok(!none.includes("Garder Pro"));
  });

  test("the pay-as-you-go preview names the service's offer instead of Louez's ladder", () => {
    const offer = render(<views.preview.PayAsYouGoPreview offerLabel={OFFER_LABEL} isPaidPlan />);
    assert.ok(offer.includes(OFFER_LABEL));
    assert.ok(!offer.includes("Votre tarif"));

    const ladder = render(
      <views.preview.PayAsYouGoPreview flatRateCents={null} bands={[]} currency="eur" isPaidPlan />,
    );
    assert.ok(ladder.includes("Votre tarif"));
    assert.ok(!ladder.includes("Votre offre Louez"));
  });
});
