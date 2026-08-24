type StaticBreadcrumbRoute = {
  href: string;
  translationKey: string;
};

export type DashboardBreadcrumbItem =
  | StaticBreadcrumbRoute
  | {
      href: string;
      label: string;
    };

const staticBreadcrumbRoutes = [
  { href: "/dashboard/ai-assistant", translationKey: "aiAssistant" },
  {
    href: "/dashboard/ai-assistant/advisor",
    translationKey: "aiAdvisor",
  },
  {
    href: "/dashboard/ai-assistant/conversations",
    translationKey: "aiConversations",
  },
  { href: "/dashboard/ai-assistant/voice", translationKey: "aiVoice" },
  { href: "/dashboard/ai-credits", translationKey: "aiCredits" },
  { href: "/dashboard/products", translationKey: "products" },
  { href: "/dashboard/products/new", translationKey: "productsNew" },
  { href: "/dashboard/reservations", translationKey: "reservations" },
  {
    href: "/dashboard/reservations/new",
    translationKey: "reservationsNew",
  },
  { href: "/dashboard/customers", translationKey: "customers" },
  { href: "/dashboard/customers/new", translationKey: "customersNew" },
  {
    href: "/dashboard/purchase-invoices",
    translationKey: "purchaseInvoices",
  },
  { href: "/dashboard/analytics", translationKey: "analytics" },
  { href: "/dashboard/analytics/sales", translationKey: "analyticsSales" },
  {
    href: "/dashboard/analytics/traffic",
    translationKey: "analyticsTraffic",
  },
  { href: "/dashboard/team", translationKey: "team" },
  { href: "/dashboard/referrals", translationKey: "referrals" },
  { href: "/dashboard/sms", translationKey: "sms" },
  { href: "/dashboard/subscription", translationKey: "subscription" },
  { href: "/dashboard/account", translationKey: "account" },
  { href: "/dashboard/whats-new", translationKey: "whatsNew" },
  { href: "/dashboard/settings", translationKey: "settings" },
  {
    href: "/dashboard/settings/admin",
    translationKey: "settingsAdmin",
  },
  {
    href: "/dashboard/settings/appearance",
    translationKey: "settingsAppearance",
  },
  {
    href: "/dashboard/settings/delivery",
    translationKey: "settingsDelivery",
  },
  {
    href: "/dashboard/settings/export",
    translationKey: "settingsExport",
  },
  {
    href: "/dashboard/settings/hours",
    translationKey: "settingsHours",
  },
  {
    href: "/dashboard/settings/inspections",
    translationKey: "settingsInspections",
  },
  {
    href: "/dashboard/settings/integrations",
    translationKey: "settingsIntegrations",
  },
  {
    href: "/dashboard/settings/invoicing",
    translationKey: "settingsInvoicing",
  },
  {
    href: "/dashboard/settings/legal",
    translationKey: "settingsLegal",
  },
  {
    href: "/dashboard/settings/notifications",
    translationKey: "settingsNotifications",
  },
  {
    href: "/dashboard/settings/payments",
    translationKey: "settingsPayments",
  },
  {
    href: "/dashboard/settings/promo-codes",
    translationKey: "settingsPromoCodes",
  },
  {
    href: "/dashboard/settings/referrals",
    translationKey: "referrals",
  },
  {
    href: "/dashboard/settings/review-booster",
    translationKey: "settingsReviewBooster",
  },
  {
    href: "/dashboard/settings/subscription",
    translationKey: "subscription",
  },
  {
    href: "/dashboard/settings/taxes",
    translationKey: "settingsTaxes",
  },
] satisfies StaticBreadcrumbRoute[];

const staticBreadcrumbRoutesByHref = new Map(
  staticBreadcrumbRoutes.map((route) => [route.href, route]),
);

const getDashboardPathPrefixes = (pathname: string) => {
  const segments = pathname.split("/").filter(Boolean);

  if (segments[0] !== "dashboard") {
    return [];
  }

  return segments.slice(1).map((_, index) => {
    return `/${segments.slice(0, index + 2).join("/")}`;
  });
};

export const getDashboardBreadcrumbItems = (
  pathname: string,
  labels: Record<string, string>,
): DashboardBreadcrumbItem[] => {
  return getDashboardPathPrefixes(pathname).flatMap<DashboardBreadcrumbItem>((href) => {
    const staticRoute = staticBreadcrumbRoutesByHref.get(href);

    if (staticRoute) {
      return [staticRoute];
    }

    const label = labels[href];

    return label ? [{ href, label }] : [];
  });
};
