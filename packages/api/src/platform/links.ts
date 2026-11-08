import type { ResourceLinks } from "../contracts/links";
import type { UrlsPort } from "./ports";

/**
 * The links of each record, built from the deployment's own addresses
 * (`ports.urls`). Every path here is a real page of apps/web: the dashboard
 * under `app/(dashboard)/dashboard`, the storefront under
 * `app/(storefront)/[slug]`.
 *
 * A storefront link is given only when the public can open it: the store has
 * finished onboarding (the storefront answers 404 before that) and, for a
 * product, the product is active (a draft or archived product has no public
 * page).
 */

/** What a link needs from the store. */
export interface LinkStore {
  slug: string;
  onboardingCompleted: boolean | null;
}

const segment = (value: string) => encodeURIComponent(value);

/** Whether the store's storefront answers the public. */
export const isStorefrontPublic = (store: LinkStore): boolean => store.onboardingCompleted === true;

/** The store's dashboard home, and its storefront home. */
export function storeLinks(urls: UrlsPort, store: LinkStore): ResourceLinks {
  return {
    dashboard: urls.dashboard("/dashboard"),
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
    dashboard: urls.dashboard(`/dashboard/products/${segment(product.id)}`),
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
    dashboard: urls.dashboard("/dashboard/categories"),
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
export function reservationLinks(urls: UrlsPort, reservation: { id: string }): ResourceLinks {
  return { dashboard: urls.dashboard(`/dashboard/reservations/${segment(reservation.id)}`) };
}

/** A customer's dashboard page. */
export function customerLinks(urls: UrlsPort, customer: { id: string }): ResourceLinks {
  return { dashboard: urls.dashboard(`/dashboard/customers/${segment(customer.id)}`) };
}

/** Settings > Integrations > MCP, where the user manages connected agents and their bundles. */
export function agentConnectionsLinks(urls: UrlsPort): ResourceLinks {
  return { dashboard: urls.dashboard("/dashboard/settings/integrations/mcp") };
}
