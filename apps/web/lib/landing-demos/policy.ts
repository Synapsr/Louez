export const DEMO_LOCALE_HEADER = "x-louez-demo-locale";
export const DEMO_ROUTE_HEADER = "x-louez-public-demo";
export const DEMO_PATH_PREFIX = "/demos/landing";
const LANDING_DEMO_SCENES = ["rental", "storefront", "planning", "reservation", "advisor"] as const;
/** One product moment per marketing feature page slot; several slots can share a scene. */
export const FEATURE_DEMO_SCENES = [
  "planning-timeline",
  "reservations-paid",
  "reservation-deposit",
  "api-key-permissions",
  "analytics-sales",
  "analytics-fleet",
  "products-list",
  "products-filter",
  "product-availability",
  "pricing-ladder",
  "pricing-seasons-promos",
  "inspection-wizard",
  "inspection-items",
  "inspection-compare",
  "inspection-settings",
  "multi-store",
  "multi-store-chart",
  "team-invite",
  "delivery-settings",
  "delivery-simulator",
  "delivery-calendar",
  "customer-detail",
  "customers-search",
  "notification-settings",
  "customer-reminders",
  "booking-confirmation",
  "storefront-product",
  "storefront-pricing",
  "storefront-quick-add",
  "storefront-extras",
  "storefront-home",
  "portal-access",
  "portal-login",
  "portal-quote",
  "portal-account",
  "checkout-payment",
  "checkout-delivery",
  "contract-document",
  "contract-content",
  "contract-trace",
] as const;
export const DEMO_SCENES = [...LANDING_DEMO_SCENES, ...FEATURE_DEMO_SCENES] as const;
export type DemoScene = (typeof DEMO_SCENES)[number];
export type FeatureDemoScene = (typeof FEATURE_DEMO_SCENES)[number];

export const isDemoPath = (pathname: string): boolean =>
  pathname === DEMO_PATH_PREFIX || pathname.startsWith(`${DEMO_PATH_PREFIX}/`);

export const isDemoScene = (value: string): value is DemoScene =>
  DEMO_SCENES.some((scene) => scene === value);

export const isFeatureDemoScene = (value: string): value is FeatureDemoScene =>
  FEATURE_DEMO_SCENES.some((scene) => scene === value);

export const parseDemoParentOrigins = (value = ""): string[] =>
  value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const url = new URL(entry);
      if (
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        url.pathname !== "/" ||
        url.search ||
        url.hash ||
        !/^https:\/\/[a-z\d.:-]+\/?$/i.test(entry)
      ) {
        throw new Error(
          "Demo parent origins must be explicit HTTPS origins without paths or credentials",
        );
      }
      return url.origin;
    });

export const getDemoParentOrigins = (
  appDomain: string | undefined,
  isDevelopment: boolean,
  additionalOrigins?: string,
): string[] => [
  ...new Set([
    ...(appDomain ? [`https://${appDomain}`, `https://www.${appDomain}`] : []),
    ...parseDemoParentOrigins(additionalOrigins),
    ...(isDevelopment
      ? ["https://landing.louez-website.localify", "https://louez-website.localify"]
      : []),
  ]),
];
