import type fr from "@/messages/fr.json";
import { isFeatureDemoScene, type DemoScene, type FeatureDemoScene } from "./policy";

export type DemoMessages = typeof fr;

type MessageTree = { [key: string]: unknown };
const isTree = (value: unknown): value is MessageTree =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The subtree holding only these dotted paths, e.g. `dashboard.settings.api`. */
export const pickMessagePaths = (messages: MessageTree, paths: readonly string[]): MessageTree => {
  const picked: MessageTree = {};
  for (const path of paths) {
    const keys = path.split(".");
    let source: unknown = messages;
    for (const key of keys) source = isTree(source) ? source[key] : undefined;
    if (source === undefined) continue;
    let target = picked;
    for (const key of keys.slice(0, -1)) {
      const next = target[key];
      target = target[key] = isTree(next) ? next : {};
    }
    const last = keys[keys.length - 1];
    const existing = target[last];
    target[last] = isTree(existing) && isTree(source) ? { ...source, ...existing } : source;
  }
  return picked;
};

// What the dashboard frame itself reads: sidebar, breadcrumbs, and the settings menu with the
// label of each of its entries.
const FRAME_PATHS = [
  "common",
  "errors",
  "dashboard.navigation",
  "dashboard.sidebar",
  "dashboard.breadcrumbs",
];
const SETTINGS_PATHS = [
  ...FRAME_PATHS,
  "dashboard.settings.title",
  "dashboard.settings.settingsNavigation",
  "dashboard.settings.company",
  "dashboard.settings.appearance",
  "dashboard.settings.salesChannels.title",
  "dashboard.settings.hours",
  "dashboard.settings.contact",
  "dashboard.settings.legal",
  "dashboard.settings.seo",
  "dashboard.settings.reservationRules",
  "dashboard.settings.payments.title",
  "dashboard.settings.taxes.title",
  "dashboard.settings.invoicing.title",
  "dashboard.settings.delivery.title",
  "dashboard.settings.inspection.title",
  "dashboard.settings.promoCodes.title",
  "dashboard.settings.notifications.title",
  "dashboard.settings.reviewBooster.title",
  "dashboard.settings.integrations",
  "dashboard.settings.referrals",
  "dashboard.settings.integrationsHub.builtIn.widget.name",
  "dashboard.settings.integrationsHub.builtIn.mcp.name",
  "dashboard.settings.integrationsHub.builtIn.api.name",
  "dashboard.settings.integrationsHub.providers.googleCalendar.name",
  "dashboard.settings.integrationsHub.providers.icsCalendar.name",
  "dashboard.settings.integrationsHub.providers.tulip.name",
  "dashboard.settings.subscription.label",
  "dashboard.settings.export.title",
  "dashboard.settings.admin.title",
];

// What the reservation file reads, for a scene whose bars or rows can open one.
const RESERVATION_FILE_PATHS = [
  "dashboard.home",
  "dashboard.calendar",
  "dashboard.products.form",
  "dashboard.reservations",
  "dashboard.emailContact",
  "dashboard.phoneContact",
  "dashboard.referrals.nudge",
  "dashboard.settings.inspection",
  "dashboard.settings.aiAdvisor.conversations",
];

// The whole dashboard slice of the landing scenes, for a feature scene that adds to it.
const DASHBOARD_PATHS = [...FRAME_PATHS, ...RESERVATION_FILE_PATHS];

// A feature scene that stays away from the reservations pages names the paths it reads, so its
// payload stays small. The others take the whole dashboard slice below.
const FEATURE_PATHS: Partial<Record<FeatureDemoScene, string[]>> = {
  "checkout-delivery": ["common", "errors", "storefront"],
  "checkout-payment": ["common", "errors", "storefront"],
  "portal-account": ["common", "errors", "storefront"],
  "portal-quote": ["common", "errors", "storefront"],
  "portal-login": ["common", "errors", "storefront"],
  "portal-access": ["common", "errors", "storefront"],
  "storefront-home": ["common", "errors", "storefront"],
  "storefront-extras": ["common", "errors", "storefront"],
  "storefront-quick-add": ["common", "errors", "storefront"],
  "storefront-pricing": ["common", "errors", "storefront"],
  "storefront-product": ["common", "errors", "storefront"],
  "customer-reminders": [...DASHBOARD_PATHS, "dashboard.settings.notifications"],
  "booking-confirmation": ["common", "errors", "storefront", "dashboard.reservations.emailModal"],
  "notification-settings": [...SETTINGS_PATHS, "dashboard.settings.notifications"],
  "customers-search": [...FRAME_PATHS, ...RESERVATION_FILE_PATHS, "dashboard.customers"],
  "customer-detail": [...FRAME_PATHS, ...RESERVATION_FILE_PATHS, "dashboard.customers"],
  "delivery-simulator": [...SETTINGS_PATHS, "dashboard.settings.delivery", "validation"],
  "delivery-settings": [...SETTINGS_PATHS, "dashboard.settings.delivery", "validation"],
  "team-invite": [...FRAME_PATHS, "dashboard.team", "validation"],
  "multi-store-chart": [
    "common",
    "errors",
    "dashboard.multiStore",
    "dashboard.analytics",
    "dashboard.theme",
    "dashboard.settings.accountSettings",
    "auth",
  ],
  "multi-store": [
    "common",
    "errors",
    "dashboard.multiStore",
    "dashboard.analytics",
    "dashboard.theme",
    "dashboard.settings.accountSettings",
    "auth",
  ],
  "inspection-settings": [...SETTINGS_PATHS, "dashboard.settings.inspection", "validation"],
  "inspection-compare": [...FRAME_PATHS, "dashboard.settings.inspection"],
  "inspection-items": [...FRAME_PATHS, "dashboard.settings.inspection"],
  "inspection-wizard": [...FRAME_PATHS, "dashboard.settings.inspection"],
  "pricing-seasons-promos": [
    ...SETTINGS_PATHS,
    "dashboard.products",
    "dashboard.settings.promoCodes",
    "validation",
  ],
  "pricing-ladder": [...FRAME_PATHS, "dashboard.products", "validation"],
  "product-availability": [
    ...FRAME_PATHS,
    ...RESERVATION_FILE_PATHS,
    "dashboard.products",
    "dashboard.inventory",
    "dashboard.calendar",
    "dashboard.reservations",
  ],
  "products-filter": [
    ...FRAME_PATHS,
    "dashboard.products",
    "dashboard.inventory",
    "dashboard.calendar",
    "dashboard.reservations",
  ],
  "products-list": [
    ...FRAME_PATHS,
    ...RESERVATION_FILE_PATHS,
    "dashboard.products",
    "dashboard.inventory",
    "dashboard.calendar",
    "dashboard.reservations",
  ],
  "analytics-fleet": [...FRAME_PATHS, "dashboard.analytics", "dashboard.statistics"],
  "analytics-sales": [...FRAME_PATHS, "dashboard.analytics", "dashboard.statistics"],
  "api-key-permissions": [...SETTINGS_PATHS, "dashboard.settings.api"],
};

// Only the slices a scene renders travel to the browser, in the page's language.
export const getDemoMessages = (scene: DemoScene, messages: DemoMessages) => {
  const paths = isFeatureDemoScene(scene) ? FEATURE_PATHS[scene] : undefined;
  if (paths) return pickMessagePaths(messages, paths);
  const dashboard = {
    home: messages.dashboard.home,
    navigation: messages.dashboard.navigation,
    sidebar: messages.dashboard.sidebar,
    calendar: messages.dashboard.calendar,
    products: { form: messages.dashboard.products.form },
    reservations: messages.dashboard.reservations,
    emailContact: messages.dashboard.emailContact,
    phoneContact: messages.dashboard.phoneContact,
    referrals: { nudge: messages.dashboard.referrals.nudge },
    settings: {
      inspection: messages.dashboard.settings.inspection,
      aiAdvisor: { conversations: messages.dashboard.settings.aiAdvisor.conversations },
    },
  };
  if (scene === "advisor") {
    return {
      storefront: { advisor: messages.storefront.advisor, product: messages.storefront.product },
    };
  }
  const shared = { common: messages.common, errors: messages.errors };
  if (scene === "storefront") return { ...shared, storefront: messages.storefront };
  if (scene === "rental") return { ...shared, storefront: messages.storefront, dashboard };
  // Dashboard scenes, feature pages included: a reservation can be opened from any of them.
  return { ...shared, dashboard };
};
