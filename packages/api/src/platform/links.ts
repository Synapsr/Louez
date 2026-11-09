import type { ResourceLinks } from "../contracts/links";
import type { UrlsPort } from "./ports";

/**
 * The links of each record, built from the deployment's own addresses
 * (`ports.urls`). Every path here is a real page of apps/web: the dashboard
 * under `app/(dashboard)/dashboard`, the storefront under
 * `app/(storefront)/[slug]`.
 *
 * A dashboard link names its store (`?store=<id>`): the dashboard shows the
 * active store of the browser, so the app switches to the named one when the
 * user is a member, then drops the parameter (apps/web proxy.ts and
 * app/api/active-store).
 *
 * A storefront link is given only when the public can open it: the store has
 * finished onboarding (the storefront answers 404 before that) and, for a
 * product, the product is active (a draft or archived product has no public
 * page).
 */

/** The query parameter of a dashboard link that names its store. */
export const DASHBOARD_STORE_PARAM = "store";

/** What a dashboard link needs from the store. */
export interface DashboardLinkStore {
  id: string;
}

/** What a link needs from the store. */
export interface LinkStore extends DashboardLinkStore {
  slug: string;
  onboardingCompleted: boolean | null;
}

const segment = (value: string) => encodeURIComponent(value);

/** A dashboard path of a store, with the store named. */
export function dashboardPath(store: DashboardLinkStore, path: string): string {
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}${DASHBOARD_STORE_PARAM}=${segment(store.id)}`;
}

const dashboardUrl = (urls: UrlsPort, store: DashboardLinkStore, path: string) =>
  urls.dashboard(dashboardPath(store, path));

/** Whether the store's storefront answers the public. */
export const isStorefrontPublic = (store: LinkStore): boolean => store.onboardingCompleted === true;

/** The store's dashboard home, and its storefront home. */
export function storeLinks(urls: UrlsPort, store: LinkStore): ResourceLinks {
  return {
    dashboard: dashboardUrl(urls, store, "/dashboard"),
    ...(isStorefrontPublic(store) ? { storefront: urls.storefront(store.slug, "/") } : {}),
  };
}

/**
 * A product's dashboard page, and its storefront page while it is active. A
 * product given without its status (a reference in another record) gets the
 * dashboard link only.
 */
export function productLinks(
  urls: UrlsPort,
  store: LinkStore,
  product: { id: string; slug?: string | null; status?: string | null },
): ResourceLinks {
  return {
    dashboard: dashboardUrl(urls, store, `/dashboard/products/${segment(product.id)}`),
    ...(product.status === "active" && isStorefrontPublic(store)
      ? // The page takes the slug, or the id on products older than slugs.
        {
          storefront: urls.storefront(
            store.slug,
            `/product/${segment(product.slug ?? product.id)}`,
          ),
        }
      : {}),
  };
}

/**
 * The dashboard's categories page (a category has no page of its own there),
 * and the storefront's catalog filtered on the category.
 */
export function categoryLinks(
  urls: UrlsPort,
  store: LinkStore,
  category: { id: string; slug: string | null },
): ResourceLinks {
  return {
    dashboard: dashboardUrl(urls, store, "/dashboard/categories"),
    ...(isStorefrontPublic(store)
      ? {
          storefront: urls.storefront(
            store.slug,
            `/catalog?category=${segment(category.slug ?? category.id)}`,
          ),
        }
      : {}),
  };
}

/** A reservation's dashboard page. The customer's own page needs their sign-in: no link. */
export function reservationLinks(
  urls: UrlsPort,
  store: DashboardLinkStore,
  reservation: { id: string },
): ResourceLinks {
  return {
    dashboard: dashboardUrl(urls, store, `/dashboard/reservations/${segment(reservation.id)}`),
  };
}

/** A customer's dashboard page. */
export function customerLinks(
  urls: UrlsPort,
  store: DashboardLinkStore,
  customer: { id: string },
): ResourceLinks {
  return {
    dashboard: dashboardUrl(urls, store, `/dashboard/customers/${segment(customer.id)}`),
  };
}

/** Another page of the store's dashboard, such as its billing or its purchase invoices. */
export function dashboardPageLinks(
  urls: UrlsPort,
  store: DashboardLinkStore,
  path: `/dashboard${string}`,
): ResourceLinks {
  return { dashboard: dashboardUrl(urls, store, path) };
}

/** Settings > Integrations > MCP, where the user manages connected agents and their bundles. */
export function agentConnectionsLinks(urls: UrlsPort, store: DashboardLinkStore): ResourceLinks {
  return { dashboard: dashboardUrl(urls, store, "/dashboard/settings/integrations/mcp") };
}

/** The settings pages of the dashboard, by section. */
export const SETTINGS_PAGES = {
  company: "/dashboard/settings",
  reservations: "/dashboard/settings/reservations",
  hours: "/dashboard/settings/hours",
  delivery: "/dashboard/settings/delivery",
  taxes: "/dashboard/settings/taxes",
  invoicing: "/dashboard/settings/invoicing",
} as const;
export type SettingsPage = keyof typeof SETTINGS_PAGES;

/** A settings page of the store, and its storefront home once it is online. */
export function settingsLinks(urls: UrlsPort, store: LinkStore, page: SettingsPage): ResourceLinks {
  return {
    dashboard: dashboardUrl(urls, store, SETTINGS_PAGES[page]),
    ...(isStorefrontPublic(store) ? { storefront: urls.storefront(store.slug, "/") } : {}),
  };
}

/** The online store editor's sections (apps/web `app/(dashboard)/online-store`). */
export type OnlineStoreSection = "identity" | "home" | "contact" | "legal" | "seo";

/** A section of the online store editor, and the storefront home once the store is online. */
export function onlineStoreLinks(
  urls: UrlsPort,
  store: LinkStore,
  section: OnlineStoreSection,
): ResourceLinks {
  return {
    dashboard: dashboardUrl(urls, store, `/online-store/${section}`),
    ...(isStorefrontPublic(store) ? { storefront: urls.storefront(store.slug, "/") } : {}),
  };
}
