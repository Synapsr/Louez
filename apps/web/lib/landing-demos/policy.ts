export const DEMO_ROUTE_HEADER = "x-louez-public-demo";
export const DEMO_PATH_PREFIX = "/demos/landing";
export const DEMO_SCENES = ["rental", "storefront", "planning", "reservation", "advisor"] as const;
export type DemoScene = (typeof DEMO_SCENES)[number];

export const isDemoPath = (pathname: string): boolean =>
  pathname === DEMO_PATH_PREFIX || pathname.startsWith(`${DEMO_PATH_PREFIX}/`);

export const isDemoScene = (value: string): value is DemoScene =>
  DEMO_SCENES.some((scene) => scene === value);

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
