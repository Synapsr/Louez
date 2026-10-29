import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import * as nodeModule from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { pathToFileURL } from "node:url";

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
// says when the difference is charged, which a change of interval alters, and why the
// last confirmation failed. The server actions and the router are stubs; the label is a
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
    if (fromThisFolder && specifier === "next/navigation")
      return { url: navigationUrl, shortCircuit: true };
    return next(specifier, context);
  },
});

const OFFER_LABEL = "Offre de test";
const PRORATION_NOTE =
  "La différence est prélevée dès maintenant, au prorata de la période en cours. Pour un plan moins cher, elle est déduite de vos prochaines factures.";
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
          {node}
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

  test("the plan change dialog says the difference is charged now, under the plans", () => {
    const html = render(
      <views.planChange.PlanChangeSummary
        currentPlanName="Pro"
        currentInterval="monthly"
        newPlanName="Ultra"
        newPlanPrice="10€"
        interval="monthly"
      />,
    );
    assert.ok(html.includes("10€ HT / mois"));
    assert.ok(html.includes(PRORATION_NOTE));
    assert.ok(html.indexOf(PRORATION_NOTE) > html.indexOf("10€ HT / mois"));
    assert.ok(!html.includes('role="alert"'));
  });

  test("a change of interval says the new period starts today, not that it is prorated", () => {
    const change = (currentInterval: "monthly" | "yearly", interval: "monthly" | "yearly") =>
      render(
        <views.planChange.PlanChangeSummary
          currentPlanName="Ultra"
          currentInterval={currentInterval}
          newPlanName="Pro"
          newPlanPrice="10€"
          interval={interval}
        />,
      );
    const toYearly = change("monthly", "yearly");
    assert.ok(
      toYearly.includes(
        "La facturation annuelle commence aujourd’hui : l’année est prélevée dès maintenant, moins la part non utilisée de la période en cours. Votre plan se renouvellera ensuite dans un an.",
      ),
    );
    assert.ok(!toYearly.includes(PRORATION_NOTE));
    const toMonthly = change("yearly", "monthly");
    assert.ok(toMonthly.includes("La facturation mensuelle commence aujourd’hui"));
    assert.ok(!toMonthly.includes(PRORATION_NOTE));
    // Yearly to yearly is a plan change.
    assert.ok(change("yearly", "yearly").includes(PRORATION_NOTE));
  });

  test("a refused plan change shows its reason in the dialog, under the note", () => {
    const reason = messages.errors.planPaymentFailed;
    const html = render(
      <views.planChange.PlanChangeSummary
        currentPlanName="Pro"
        currentInterval={null}
        newPlanName="Ultra"
        newPlanPrice="10€"
        interval="monthly"
        error={reason}
      />,
    );
    assert.ok(html.includes(reason));
    assert.ok(html.indexOf(reason) > html.indexOf(PRORATION_NOTE));

    // The dialog opens only after a click, which a static render cannot make: the page's
    // source is checked instead, so that its dialog keeps this body and the reason.
    const page = readFileSync(new URL("./subscription-management.tsx", import.meta.url), "utf8");
    const opens = page.indexOf("open={pendingChange !== null}");
    assert.ok(opens > 0);
    const dialog = page.slice(opens, page.indexOf("</Dialog>", opens));
    assert.match(dialog, /<PlanChangeSummary\b[\s\S]*?\berror=\{changeError && errorText\(changeError\)\}[\s\S]*?\/>/);
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
