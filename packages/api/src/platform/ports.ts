import type { ReservationEffectRunner, ReservationGateReason, Transaction } from "@louez/db";

import type { Transport } from "./actor";

/**
 * What the agent-ready API takes from the app that serves it: only what is
 * bound to Next.js or to the billing service, and, for now, the image
 * storage (see `StoragePort`), the insurance contracts (`InsurancePort`) and
 * the app's effects of a write (`afterCommit`). Business code (Stripe,
 * e-mail…) lives in the package as services and adapters, never here.
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
  /**
   * Records or voids the pay-as-you-go fee of a reservation status change
   * (billing), right after its commit and before the answer. Never throws.
   */
  runReservationEffects: ReservationEffectRunner;
  insurance: InsurancePort;
  /**
   * Sends effects a write added to the outbox (`platform/effects.ts`), once
   * its transaction has committed. The app sends them after the answer; its
   * cron retries the failed ones. Never throws.
   */
  dispatchEffects: (ids: readonly string[]) => void;
  newStores: NewStorePort;
}

/**
 * What creating a store takes from the app (services/store-creation.ts): the
 * billing of a new store, owned by the billing service and Louez's legacy
 * pricing; the instance's mode; the sign-up attribution a dashboard request
 * carries in its cookies.
 */
export interface NewStorePort {
  /** A standalone instance hosts one store: a second one is refused. */
  singleStore: () => boolean;
  /** What a store created now in `currency` pays Louez: what the preview shows. */
  terms: (input: { currency: string; referred: boolean }) => Promise<NewStoreTerms>;
  /**
   * Writes the new store's subscription row in the transaction that creates
   * it (pay-as-you-go with the offer for new stores). True when Louez's own
   * billing bills the store, false when it writes nothing.
   */
  insertSubscription: (
    tx: Transaction,
    input: { storeId: string; currency: string; referred: boolean },
  ) => Promise<boolean>;
  /**
   * The referral code and the sign-up origin a dashboard request carries
   * (cookies set when the user arrived), each null when absent or unknown.
   */
  signupAttribution: (headers: Headers) => {
    referralCode: string | null;
    signupOrigin: string | null;
  };
}

/** What a new store pays Louez, as the billing code says it (see `NewStorePort.terms`). */
export type NewStoreTerms =
  /** An instance without platform billing. */
  | { billing: "none" }
  /** Louez's own billing: a fee per reservation, by monthly band, after free reservations. */
  | {
      billing: "pay_as_you_go";
      freeReservations: number;
      /** Fees in the store's currency, in minor units. */
      tiers: ReadonlyArray<{ upToCount: number | null; priceMinor: number }>;
      currency: string;
    }
  /** The billing service bills the store: its offer's label is the figure (null when unknown). */
  | { billing: "offer"; offer: string | null };

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

/**
 * The store's insurance contracts (Tulip), lent to the reservation status
 * changes until the integration moves into the package (lot 7). Both run
 * after the commit and never throw: a failure is logged by the app.
 */
export interface InsurancePort {
  /** Creates the contract of a confirmed reservation; the warning to show when it failed. */
  createContract: (reservationId: string) => Promise<{ key: string } | null>;
  /** Cancels the contract of a cancelled reservation. */
  cancelContract: (reservationId: string) => Promise<void>;
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
  | { type: "product.units.changed"; store: ApiEventStore; productId: string }
  /** A reservation's status or notes changed: its pages are revalidated. Its messages go to the outbox. */
  | { type: "reservation.statusChanged"; store: ApiEventStore; reservationId: string }
  | { type: "reservation.notesUpdated"; store: ApiEventStore; reservationId: string }
  /** Not a write: the store's card gate refused a status change; the app logs it. */
  | {
      type: "reservation.gateRefused";
      store: ApiEventStore;
      transport: Transport;
      reason: ReservationGateReason;
    };

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
