import type { Transport } from "./actor";

/**
 * What the agent-ready API takes from the app that serves it: only what is
 * bound to Next.js or to the billing service, and, for now, the image
 * storage (see `StoragePort`) and the app's effects of a write
 * (`afterCommit`). Business code (Stripe, e-mail…) lives in the package as
 * services and adapters, never here.
 *
 * Every handler of the app (RPC, OpenAPI, MCP, uploads) builds the same object
 * and puts it in the context as `ports`.
 */
export interface ApiPorts {
  /** Features of the plan in force for the store (billing owns plans). */
  planFeatures: (storeId: string) => Promise<{ apiAccess: boolean }>;
  storage: StoragePort;
  /**
   * The effects of a committed write that the app still owns: page
   * revalidation (Next.js), platform notifications (Discord, fromHello) and
   * product analytics (PostHog). Called once the transaction has committed;
   * it must never throw, and the answer does not wait for it.
   */
  afterCommit: (event: ApiEvent) => void;
  urls: UrlsPort;
}

/**
 * The deployment's own addresses, from its settings (app URL, app domain,
 * deployment mode): a preview builds the preview's URLs. The links a
 * procedure returns (platform/links.ts) are built only through this port.
 */
export interface UrlsPort {
  /** Absolute URL of a dashboard path, such as `/dashboard/products/<id>`. */
  dashboard: (path: string) => string;
  /**
   * Absolute URL of a path on a store's storefront, routed as this deployment
   * routes storefronts (store subdomain, `/<slug>` on a local domain, or the
   * app's root in standalone mode).
   */
  storefront: (storeSlug: string, path: string) => string;
}

/** The store an event happened in, as the app's effects need it. */
export interface ApiEventStore {
  id: string;
  name: string;
  slug: string;
  /** The store owner: analytics count the event on them. */
  ownerUserId: string;
}

/** What a committed write did, for `afterCommit`. */
export type ApiEvent =
  | {
      type: "product.created";
      store: ApiEventStore;
      transport: Transport;
      productId: string;
      productName: string;
      /** Facts about the new product, for analytics. */
      facts: Record<string, string | number | boolean | null>;
    }
  | { type: "product.updated"; store: ApiEventStore; productId: string; productName: string }
  /** A change the products list shows: status, deletion, duplicate, order. */
  | { type: "products.changed"; store: ApiEventStore }
  | { type: "product.seasonalPricing.changed"; store: ApiEventStore; productId: string }
  /** A unit retired, reinstated or changed, or a downtime declared, changed or removed. */
  | { type: "product.units.changed"; store: ApiEventStore; productId: string };

/** How a caller sends the bytes of an upload: one HTTP request, as given. */
export type UploadTarget =
  | { method: "PUT"; url: string; headers: Record<string, string> }
  | { method: "POST"; url: string; fields: Record<string, string> };

/**
 * The app's image storage, lent to the upload procedures
 * (services/uploads.ts). The storage client is configured from the app's
 * environment and shared with the dashboard's file routes and the `/files`
 * route; it moves into the package as an adapter when products need it too.
 * Keys are full storage keys (`<storeId>/categories/<id>.png`); the upload
 * service mints and checks them, the port never decides who owns what.
 */
export interface StoragePort {
  /**
   * A presigned upload straight to the bucket, bound to `contentType` and at
   * most `maxSize` bytes; null when the bucket is private and served through
   * the app, so uploads must go through the app (`uploadUrl`).
   */
  signUpload: (
    key: string,
    options: { contentType: string; maxSize: number; expiresIn: number },
  ) => Promise<UploadTarget | null>;
  /** Absolute URL of the app's upload endpoint for an upload token. */
  uploadUrl: (token: string) => string;
  /** Stores bytes received by the app's upload endpoint. */
  put: (key: string, body: Uint8Array, contentType: string) => Promise<void>;
  /** Size and type of a stored object, or null when there is none. */
  head: (key: string) => Promise<{ size: number; contentType: string } | null>;
  /** The first `length` bytes of a stored object. */
  readStart: (key: string, length: number) => Promise<Uint8Array>;
  /** Makes a stored object publicly readable; returns its public URL. */
  publish: (key: string) => Promise<string>;
  delete: (key: string) => Promise<void>;
}
