export const DEMO_ROUTE_HEADER = "x-louez-public-demo";
export const DEMO_PATH_PREFIX = "/demos/landing";
export const DEMO_SCENES = ["rental", "storefront", "planning", "reservation", "advisor"] as const;
export type DemoScene = (typeof DEMO_SCENES)[number];

export const isDemoPath = (pathname: string): boolean =>
  pathname === DEMO_PATH_PREFIX || pathname.startsWith(`${DEMO_PATH_PREFIX}/`);

export const isDemoScene = (value: string): value is DemoScene =>
  DEMO_SCENES.some((scene) => scene === value);

export const getDemoParentOrigins = (
  appDomain: string | undefined,
  isDevelopment: boolean,
): string[] => [
  ...(appDomain ? [`https://${appDomain}`, `https://www.${appDomain}`] : []),
  ...(isDevelopment
    ? ["https://landing.louez-website.localify", "https://louez-website.localify"]
    : []),
];
