import type { ReservationEffectRunner, ReservationGateReason, Transaction } from "@louez/db";
import type { StoreSettings } from "@louez/types";

import type { StripeConnectClient } from "../adapters/stripe-connect";
import type { BillingStatus } from "../contracts/billing";
import type { Transport } from "./actor";
import type { ReportServerError } from "./error-reporting";

/**
 * What the agent-ready API takes from the app that serves it: only what is
 * bound to Next.js or to the billing service, and, for now, the image
 * storage (see `StoragePort`), the insurance contracts (`InsurancePort`), the
 * AI photo pipeline and credits (`ProductImagesPort`) and the app's effects
 * of a write (`afterCommit`). Business code (Stripe,
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
  /**
   * Runs background jobs (`platform/jobs.ts`) a write queued, once its
   * transaction has committed. The app runs them after the answer, a few at
   * a time per process; its cron takes the ones left. Never throws. Absent
   * where no procedure queues one.
   */
  dispatchJobs?: (ids: readonly string[]) => void;
  /**
   * The AI photo pipeline and the AI credits, for the image jobs
   * (services/product-images.ts), until the AI layer moves into the package
   * (lot 7). Absent where no procedure needs it.
   */
  productImages?: ProductImagesPort;
  newStores: NewStorePort;
  /**
   * Who hosts this instance (`LOUEZ_HOSTED_BY`): on Louez Cloud the
   * storefront's legal notice names the host itself. Absent or null: the
   * operator hosts it, and the store's legal notice must name them.
   */
  hostedBy?: () => "lumycloud" | null;
  /**
   * The app's configured Stripe client, for Stripe Connect
   * (adapters/stripe-connect.ts), or null when this instance has no Stripe.
   * Absent where no procedure needs it.
   */
  stripeConnect?: () => StripeConnectClient | null;
  /** Louez's billing of the store, owned by the app and the billing service. */
  billing?: BillingPort;
  /**
   * The store's deposit holds (apps/web lib/reservations/deposit-hold.ts): its Stripe
   * calls and its one writer, until the deposit hold moves into the package. Absent
   * where no procedure needs it.
   */
  depositHolds?: DepositHoldsPort;
  /**
   * The app's writer of a payment the store records by hand
   * (services/payment-records.ts): the billing facts it adds are the app's.
   * Absent where no procedure needs it.
   */
  paymentRecords?: PaymentRecordsPort;
  /**
   * What the team procedures read from the app (services/team.ts). Absent
   * where no procedure needs it: no seat limit, and e-mail counted as sent.
   */
  team?: TeamPort;
  /**
   * Sends an unexpected server error to the app's error tracking
   * (platform/error-reporting.ts). Never throws, never waits. Absent: nothing
   * is sent (tests, scripts, an instance without error tracking).
   */
  reportError?: ReportServerError;
  /**
   * The app's structured logger, for what went wrong out of the caller's
   * sight. Each event holds sanitized facts only (`sanitize-error.ts`).
   * Absent: one JSON line on stderr.
   */
  log?: LogPort;
}

/** What the store's closing of an unconfirmed deposit hold came to. */
export type DepositAttemptResolution =
  | {
      ok: true;
      /** `closed`, or what the PaymentIntent Louez found at Stripe was recorded as. */
      outcome:
        | "closed"
        | "authorized"
        | "superseded"
        | "captured"
        | "released"
        | "failed"
        | "pending";
      paymentIntentId: string | null;
    }
  | {
      ok: false;
      error: "reservation_not_found" | "no_unconfirmed_attempt" | "attempt_in_progress";
    }
  | {
      ok: false;
      /**
       * Louez found the attempt's PaymentIntent, which does not match the attempt, and
       * Stripe may hold funds on it: the attempt is not closed.
       */
      error: "attempt_needs_stripe";
      paymentIntentId: string;
      /** Its status at Stripe. */
      status: string;
      /** Why it is not the attempt's: `facts_mismatch`, `other_reservation`… */
      reason: string;
      /** For a `facts_mismatch`, what differs: `amount`, `currency`, `card`, `customer`. */
      unmatchedFacts: readonly string[];
    };

/** The store's deposit holds, lent by the app (apps/web lib/api/deposit-holds-port.ts). */
export interface DepositHoldsPort {
  /**
   * Closes the reservation's deposit hold attempt Stripe has not confirmed, on the
   * store's word, once Louez's own lookup, when it can make one, found nothing; what it
   * finds is recorded instead, and what it finds but cannot record keeps the attempt
   * open while Stripe may hold funds on it.
   */
  resolveUnconfirmedAttempt: (input: {
    reservationId: string;
    storeId: string;
    actorUserId: string;
  }) => Promise<DepositAttemptResolution>;
}

/** A structured log event: a name, then fields that hold no personal data. */
export interface LogPort {
  error: (event: { event: string } & Record<string, unknown>) => void;
}

/** A payment the store records by hand, as the app's writer takes it. */
export interface RecordedPayment {
  reservationId: string;
  storeId: string;
  storeSettings: Pick<StoreSettings, "currency" | "tax"> | null;
  type: "rental" | "deposit" | "deposit_return" | "damage" | "adjustment";
  method: "cash" | "card" | "transfer" | "check" | "other";
  /** As stored, `decimal(10,2)`. */
  amount: string;
  /** `deposit` for a deposit given back, `manual` otherwise. */
  origin: "manual" | "deposit";
  paidAt: Date;
  notes: string | null;
}

/** The app's writer of the payments a store records by hand (`ApiPorts.paymentRecords`). */
export interface PaymentRecordsPort {
  /**
   * In the caller's transaction: the payment, under a new id, in the
   * reservation's currency with its billing facts (gross, insurance share),
   * and the reservation's mark for the billing service.
   */
  insert: (tx: Transaction, payment: RecordedPayment) => Promise<void>;
}

/** The plan's team seats (billing owns plans) and whether this instance sends e-mail. */
export interface TeamPort {
  /** Most members with the `member` role the store's plan allows; null for unlimited. */
  collaboratorLimit: (storeId: string) => Promise<number | null>;
  /** Whether this instance can send e-mail: without it, the user shares the invitation link. */
  emailConfigured: () => boolean;
}

/** An AI photo operation: GPT Image with a cut-out background, or the cut-out alone. */
export type ProductImageOperation = "enhance" | "remove-background";

/** What an operation costs the store now, and whether this instance can run it. */
export interface ProductImageQuote {
  /** The instance has the providers it needs (GPT Image and rembg, or rembg alone). */
  available: boolean;
  /** What one run costs, in micro-credits; 0 when it is free or the credit layer is off. */
  priceMicro: number;
  /** The store's credits, when the run is billed; null otherwise. */
  credits: {
    /** The gate the dashboard applies: some credit left in either pocket. */
    allowed: boolean;
    /** What is left of this month's included credits; null for unlimited. */
    monthlyRemainingMicro: number | null;
    prepaidMicro: number;
  } | null;
}

/** Where an image to process is read from: the store's own product folder, or a demo catalog's trusted bucket. */
export type ProductImageSource =
  | { kind: "stored"; key: string }
  | { kind: "trusted-demo"; key: string; url: string };

/** A processed image, stored under the key the caller gave. */
export interface ProcessedProductImage {
  url: string;
  /** How the result was framed (`auto`, `contain`…); null when unknown. */
  framingMode: string | null;
  /** What the providers cost Louez, for the debit row. */
  providerCostMicroUsd: number;
  /** What the app keeps of the run for its diagnostics; opaque to the API. */
  report: unknown;
}

/**
 * Why processing an image failed. `retryable`: the same run may succeed later
 * (a provider outage, a timeout); otherwise it never will (an empty result,
 * an unreadable source).
 */
export class ProductImageFailure extends Error {
  constructor(
    readonly code:
      | "IMAGE_SOURCE_UNREADABLE"
      | "IMAGE_EMPTY"
      | "PROVIDER_ERROR"
      | "BACKGROUND_REMOVAL_ERROR"
      | "STORAGE_ERROR"
      | "PROCESSING_ERROR",
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "ProductImageFailure";
  }
}

/**
 * The app's AI photo pipeline (apps/web lib/ai/image): the same code the
 * dashboard's enhance route runs, so a result, its price and its debit are
 * the same whoever asked.
 */
export interface ProductImagesPort {
  quote: (storeId: string, operation: ProductImageOperation) => Promise<ProductImageQuote>;
  /** Where the image at `url` is read from, when the store may process it; null otherwise. */
  resolveSource: (storeId: string, url: string) => ProductImageSource | null;
  /**
   * Reads the source, runs the pipeline and stores the result under `key`,
   * replacing what is there. Throws a `ProductImageFailure`; stops when
   * `signal` aborts.
   */
  process: (input: {
    storeId: string;
    source: ProductImageSource;
    operation: ProductImageOperation;
    /** Tells GPT Image which object to keep. */
    productName: string;
    key: string;
    signal: AbortSignal;
  }) => Promise<ProcessedProductImage>;
  /** Deletes a stored result nobody will use. */
  discard: (key: string) => Promise<void>;
  /**
   * Debits one run in the caller's transaction, once per `dedupKey`, exactly
   * `priceMicro`: the price frozen when the run was started (and confirmed),
   * never the tariff in force now. Never called with a price of 0, which
   * writes no debit. `tx` runs READ COMMITTED: it read other rows before the
   * debit takes the store's credits lock, and the debit's sum of the month's
   * credits, taken under that lock, must see every debit committed meanwhile.
   * The micro-credits debited (0 when the key was already debited). Throws
   * when the debit could not be written.
   */
  debit: (
    tx: Transaction,
    input: {
      storeId: string;
      priceMicro: number;
      dedupKey: string;
      imageKey: string;
      providerCostMicroUsd: number;
    },
  ) => Promise<number>;
  /** Once the run's debit committed: the auto top-up, the diagnostics. Never throws. */
  afterSuccess: (input: {
    storeId: string;
    runId: string;
    operation: ProductImageOperation;
    sourceKey: string;
    key: string;
    debitedMicro: number;
    report: unknown;
  }) => Promise<void>;
}

/**
 * What the billing pages read and the billing card's checkout
 * (apps/web lib/billing, lib/billing-sync/pages.ts), for billing.getStatus
 * and the `billing_card_setup` handoff.
 */
export interface BillingPort {
  /** What the billing pages show, without the gate and the links (the service adds them). */
  status: (input: {
    storeId: string;
    locale: string;
    now: Date;
  }) => Promise<Omit<BillingStatus, "gate" | "cardSetup" | "links"> & BillingCardSetupState>;
  /** Whether Louez's billing service bills the store now: only then has it a card to add. */
  billedByService: (storeId: string, now: Date) => Promise<boolean>;
  /** Stripe Checkout in setup mode for the store's card, back to `returnUrl`. */
  startCardSetup: (input: {
    storeId: string;
    userId: string;
    locale: string;
    returnUrl: string;
  }) => Promise<{ ok: true; url: string } | { ok: false; reason: "unavailable" | "failed" }>;
  /**
   * Saves the card of the Checkout the user came back from, then refreshes the
   * store's policies: `refreshed` once both went through, `pending` while
   * Stripe has not confirmed the card.
   */
  finishCardSetup: (input: {
    storeId: string;
    checkoutSessionId: string;
  }) => Promise<"refreshed" | "pending">;
}

/** Whether the billing service would open a card setup for the store now. */
export interface BillingCardSetupState {
  cardSetupOpen: boolean;
  cardSetupBlocked: "not_billed_by_service" | "off" | "in_louez" | null;
}

/**
 * What creating a store takes from the app (services/store-creation.ts): the
 * billing of a new store, owned by the billing service and Louez's legacy
 * pricing; the welcome AI credits; the instance's mode; the sign-up
 * attribution a dashboard request carries in its cookies.
 */
export interface NewStorePort {
  /** A standalone instance hosts one store: a second one is refused. */
  singleStore: () => boolean;
  /**
   * What a store created now in `currency` would pay Louez: what the preview
   * shows before the store exists. The creation checks it again (`subscribe`).
   */
  previewTerms: (input: { currency: string; referred: boolean }) => Promise<NewStoreTerms>;
  /**
   * In the transaction that just inserted the store: decides once, through
   * `tx`, whether Louez's own billing bills it, writes its subscription row
   * when it does (pay-as-you-go with the offer for new stores), and returns
   * the terms of that same decision.
   */
  subscribe: (
    tx: Transaction,
    input: { storeId: string; currency: string; referred: boolean },
  ) => Promise<NewStoreTerms>;
  /** The AI credits a new store gets now; 0 while the credit layer is off. */
  welcomeCredits: () => number;
  /**
   * The referral code and the sign-up origin a dashboard request carries
   * (cookies set when the user arrived), and the Klibon affiliate code the
   * page read from Klibon's tag; each null when absent or unknown.
   */
  signupAttribution: (headers: Headers) => {
    referralCode: string | null;
    signupOrigin: string | null;
    affiliateReferral: string | null;
  };
  /**
   * In the transaction that saves the onboarding's store step on a store
   * that already existed and was just attributed to a referrer: its
   * referred reward (more free reservations, at the pricing it already pays)
   * when Louez's own billing bills it. Whether it got it.
   */
  rewardReferredStore: (tx: Transaction, storeId: string) => Promise<boolean>;
  /**
   * The `Set-Cookie` values of a dashboard answer once the onboarding's store
   * step saved or created a store: it becomes the active store, and the
   * referral cookie it was attributed from is spent, so it attributes no
   * later store.
   */
  onboardingCookies: (input: { activeStoreId: string; spendReferral: boolean }) => string[];
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

/** A section of the store settings (services/settings.ts). */
export type SettingsSection =
  | "storeInfo"
  | "company"
  | "legal"
  | "reservationRules"
  | "businessHours"
  | "delivery"
  | "locations"
  | "taxes";

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
  /** A section of the store settings changed: its pages are revalidated. */
  | { type: "store.settingsUpdated"; store: ApiEventStore; section: SettingsSection }
  /** The online store's sections or look changed; `themeChanged`: its cached theme colour is stale. */
  | { type: "store.storefrontUpdated"; store: ApiEventStore; themeChanged: boolean }
  /** The store's legal profile was saved: its invoicing page, and the PDP's VAT regime. */
  | { type: "store.legalProfileUpdated"; store: ApiEventStore }
  /** The store went live: its storefront is public now. */
  | { type: "store.launched"; store: ApiEventStore }
  /** Someone was invited to the store, or added to it: the team page, and the platform's notice. */
  | { type: "team.memberInvited"; store: ApiEventStore; email: string }
  /** A member removed, an invitation cancelled or sent again: the team page. */
  | { type: "team.changed"; store: ApiEventStore }
  /** The store moved to a new web address (`store.slug`). */
  | { type: "store.slugChanged"; store: ApiEventStore; previousSlug: string }
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
