import assert from "node:assert/strict";
import test from "node:test";

import { getDashboardBreadcrumbItems } from "./util.dashboard-breadcrumbs";

test("covers every static dashboard breadcrumb route", () => {
  const cases = [
    ["/dashboard/ai-assistant", ["aiAssistant"]],
    ["/dashboard/ai-assistant/advisor", ["aiAssistant", "aiAdvisor"]],
    ["/dashboard/ai-assistant/conversations", ["aiAssistant", "aiConversations"]],
    ["/dashboard/ai-assistant/voice", ["aiAssistant", "aiVoice"]],
    ["/dashboard/ai-credits", ["aiCredits"]],
    ["/dashboard/products", ["products"]],
    ["/dashboard/products/new", ["products", "productsNew"]],
    ["/dashboard/reservations", ["reservations"]],
    ["/dashboard/reservations/new", ["reservations", "reservationsNew"]],
    ["/dashboard/customers", ["customers"]],
    ["/dashboard/customers/new", ["customers", "customersNew"]],
    ["/dashboard/purchase-invoices", ["purchaseInvoices"]],
    ["/dashboard/analytics", ["analytics"]],
    ["/dashboard/analytics/sales", ["analytics", "analyticsSales"]],
    ["/dashboard/analytics/traffic", ["analytics", "analyticsTraffic"]],
    ["/dashboard/team", ["team"]],
    ["/dashboard/referrals", ["referrals"]],
    ["/dashboard/sms", ["sms"]],
    ["/dashboard/subscription", ["subscription"]],
    ["/dashboard/account", ["account"]],
    ["/dashboard/whats-new", ["whatsNew"]],
    ["/dashboard/settings", ["settings"]],
    ["/dashboard/settings/admin", ["settings", "settingsAdmin"]],
    ["/dashboard/settings/appearance", ["settings", "settingsAppearance"]],
    ["/dashboard/settings/delivery", ["settings", "settingsDelivery"]],
    ["/dashboard/settings/export", ["settings", "settingsExport"]],
    ["/dashboard/settings/hours", ["settings", "settingsHours"]],
    ["/dashboard/settings/inspections", ["settings", "settingsInspections"]],
    ["/dashboard/settings/integrations", ["settings", "settingsIntegrations"]],
    ["/dashboard/settings/legal", ["settings", "settingsLegal"]],
    ["/dashboard/settings/notifications", ["settings", "settingsNotifications"]],
    ["/dashboard/settings/payments", ["settings", "settingsPayments"]],
    ["/dashboard/settings/promo-codes", ["settings", "settingsPromoCodes"]],
    ["/dashboard/settings/referrals", ["settings", "referrals"]],
    ["/dashboard/settings/review-booster", ["settings", "settingsReviewBooster"]],
    ["/dashboard/settings/subscription", ["settings", "subscription"]],
    ["/dashboard/settings/taxes", ["settings", "settingsTaxes"]],
  ] satisfies Array<[pathname: string, translationKeys: string[]]>;

  for (const [pathname, translationKeys] of cases) {
    const items = getDashboardBreadcrumbItems(pathname, {});

    assert.deepEqual(
      items.map((item) => ("translationKey" in item ? item.translationKey : item.label)),
      translationKeys,
      pathname,
    );
  }
});

test("prefers the static route over a label registered by the page shell", () => {
  // `SettingsPageShell` registers its title for the current path. On routes the
  // table already names, that must stay a no-op — one crumb, translated, never
  // a second one next to it.
  assert.deepEqual(
    getDashboardBreadcrumbItems("/dashboard/ai-assistant/voice", {
      "/dashboard/ai-assistant/voice": "Agent vocal",
      "/dashboard/ai-credits": "Crédits IA",
    }),
    [
      { href: "/dashboard/ai-assistant", translationKey: "aiAssistant" },
      { href: "/dashboard/ai-assistant/voice", translationKey: "aiVoice" },
    ],
  );
});

test("builds collection and creation breadcrumbs from the route hierarchy", () => {
  assert.deepEqual(getDashboardBreadcrumbItems("/dashboard/reservations/new", {}), [
    {
      href: "/dashboard/reservations",
      translationKey: "reservations",
    },
    {
      href: "/dashboard/reservations/new",
      translationKey: "reservationsNew",
    },
  ]);

  assert.deepEqual(getDashboardBreadcrumbItems("/dashboard/products/new", {}), [
    {
      href: "/dashboard/products",
      translationKey: "products",
    },
    {
      href: "/dashboard/products/new",
      translationKey: "productsNew",
    },
  ]);

  assert.deepEqual(getDashboardBreadcrumbItems("/dashboard/customers/new", {}), [
    {
      href: "/dashboard/customers",
      translationKey: "customers",
    },
    {
      href: "/dashboard/customers/new",
      translationKey: "customersNew",
    },
  ]);
});

test("uses registered labels for dynamic detail and edit routes", () => {
  const productPath = "/dashboard/products/product-1";
  const editPath = `${productPath}/edit`;

  assert.deepEqual(
    getDashboardBreadcrumbItems(editPath, {
      [productPath]: "Camera",
      [editPath]: "Edit",
    }),
    [
      {
        href: "/dashboard/products",
        translationKey: "products",
      },
      { href: productPath, label: "Camera" },
      { href: editPath, label: "Edit" },
    ],
  );
});

test("keeps a reservation as the parent of inspection pages", () => {
  const reservationPath = "/dashboard/reservations/reservation-1";
  const inspectionPath = `${reservationPath}/inspection/departure`;

  assert.deepEqual(
    getDashboardBreadcrumbItems(inspectionPath, {
      [reservationPath]: "#1042",
      [inspectionPath]: "Departure inspection",
    }),
    [
      {
        href: "/dashboard/reservations",
        translationKey: "reservations",
      },
      { href: reservationPath, label: "#1042" },
      { href: inspectionPath, label: "Departure inspection" },
    ],
  );
});

test("keeps settings and integrations as parents of integration detail pages", () => {
  const integrationPath = "/dashboard/settings/integrations/google-calendar";

  assert.deepEqual(
    getDashboardBreadcrumbItems(integrationPath, {
      [integrationPath]: "Google Calendar",
    }),
    [
      {
        href: "/dashboard/settings",
        translationKey: "settings",
      },
      {
        href: "/dashboard/settings/integrations",
        translationKey: "settingsIntegrations",
      },
      { href: integrationPath, label: "Google Calendar" },
    ],
  );
});

test("covers direct dashboard pages and ignores routes outside the dashboard", () => {
  assert.deepEqual(getDashboardBreadcrumbItems("/dashboard/ai-assistant", {}), [
    {
      href: "/dashboard/ai-assistant",
      translationKey: "aiAssistant",
    },
  ]);
  assert.deepEqual(getDashboardBreadcrumbItems("/dashboard/referrals", {}), [
    {
      href: "/dashboard/referrals",
      translationKey: "referrals",
    },
  ]);
  assert.deepEqual(getDashboardBreadcrumbItems("/dashboard/subscription", {}), [
    {
      href: "/dashboard/subscription",
      translationKey: "subscription",
    },
  ]);
  assert.deepEqual(getDashboardBreadcrumbItems("/onboarding", {}), []);
});
