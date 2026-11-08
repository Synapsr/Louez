import {
  categories,
  db,
  lockStoreRow,
  markStore,
  products,
  readReservationGate,
  reservations,
  storeLocations,
  stores,
  type ReservationGate,
  type Transaction,
} from "@louez/db";
import type { StoreSettings } from "@louez/types";
import { hasRichTextContent } from "@louez/utils";
import { and, eq, gt } from "drizzle-orm";

import {
  LAUNCH_ITEM_KEYS,
  launchErrors,
  type GoLiveInput,
  type LaunchChecklistView,
  type LaunchItem,
  type LaunchItemKey,
  type LaunchItemStatus,
} from "../contracts/launch";
import { analyticsEventIdentity, enqueueEffects } from "../platform/effects";
import { dashboardPath, isStorefrontPublic, storeLinks } from "../platform/links";
import { platformErrors } from "../platform/errors";
import type { Transport } from "../platform/actor";
import type { ApiEvent, UrlsPort } from "../platform/ports";
import type { ConfirmStep } from "./products";
import type { SettingsActor } from "./settings";

/**
 * A store's launch. The checklist says what the store still lacks before
 * customers can book, from what is stored; the dashboard's home and the
 * agents read the same one. Going live is the onboarding's last step: it
 * sets the booking mode and puts the storefront online (`onboardingCompleted`).
 *
 * Only the store info is required, as it is all the onboarding wizard asks
 * for: a human finishes the wizard before adding a product. Everything else
 * is shown as missing or optional, so the user decides with the preview.
 */

// --- Reading ----------------------------------------------------------------

const storeColumns = {
  id: stores.id,
  name: stores.name,
  slug: stores.slug,
  email: stores.email,
  phone: stores.phone,
  address: stores.address,
  latitude: stores.latitude,
  longitude: stores.longitude,
  settings: stores.settings,
  cgv: stores.cgv,
  legalNotice: stores.legalNotice,
  logoUrl: stores.logoUrl,
  stripeAccountId: stores.stripeAccountId,
  stripeChargesEnabled: stores.stripeChargesEnabled,
  onboardingCompleted: stores.onboardingCompleted,
};

type LaunchStoreRow = {
  [K in keyof typeof storeColumns]: (typeof stores.$inferSelect)[K];
};

/** What the checklist is computed from: the store row and a few facts of its other tables. */
export interface LaunchState {
  store: LaunchStoreRow;
  hasPricedProduct: boolean;
  hasCategory: boolean;
  hasActiveLocation: boolean;
  gate: ReservationGate;
  /** Null when the caller may not read reservations. */
  milestones: { firstReservation: boolean; firstCompletedReservation: boolean } | null;
}

type Executor = typeof db | Transaction;

async function exists(query: Promise<Array<{ id: string }>>): Promise<boolean> {
  return (await query).length > 0;
}

/** Reads what the checklist needs. In a write, call it once the store row is locked. */
export async function readLaunchState(
  executor: Executor,
  storeId: string,
  options: { withMilestones: boolean },
): Promise<LaunchState> {
  const [store] = await executor.select(storeColumns).from(stores).where(eq(stores.id, storeId));
  if (!store) throw platformErrors.noStore();

  const [hasPricedProduct, hasCategory, hasActiveLocation, gate, firstReservation, firstCompleted] =
    await Promise.all([
      exists(
        executor
          .select({ id: products.id })
          .from(products)
          .where(
            and(
              eq(products.storeId, storeId),
              eq(products.status, "active"),
              gt(products.price, "0"),
            ),
          )
          .limit(1),
      ),
      exists(
        executor
          .select({ id: categories.id })
          .from(categories)
          .where(eq(categories.storeId, storeId))
          .limit(1),
      ),
      exists(
        executor
          .select({ id: storeLocations.id })
          .from(storeLocations)
          .where(and(eq(storeLocations.storeId, storeId), eq(storeLocations.isActive, true)))
          .limit(1),
      ),
      readReservationGate(executor, storeId),
      options.withMilestones
        ? exists(
            executor
              .select({ id: reservations.id })
              .from(reservations)
              .where(eq(reservations.storeId, storeId))
              .limit(1),
          )
        : Promise.resolve(false),
      options.withMilestones
        ? exists(
            executor
              .select({ id: reservations.id })
              .from(reservations)
              .where(and(eq(reservations.storeId, storeId), eq(reservations.status, "completed")))
              .limit(1),
          )
        : Promise.resolve(false),
    ]);

  return {
    store,
    hasPricedProduct,
    hasCategory,
    hasActiveLocation,
    gate,
    milestones: options.withMilestones
      ? { firstReservation, firstCompletedReservation: firstCompleted }
      : null,
  };
}

// --- The checklist ----------------------------------------------------------

/** What the storefront does with the store's booking mode (ADR 0004): payment needs Stripe. */
export function bookingModeOf(
  store: Pick<LaunchStoreRow, "settings" | "stripeAccountId" | "stripeChargesEnabled">,
  intended?: "payment" | "request",
) {
  const mode = intended ?? (store.settings?.reservationMode === "request" ? "request" : "payment");
  const stripeChargeable = Boolean(store.stripeAccountId && store.stripeChargesEnabled);
  return {
    intended: mode,
    effective: mode === "payment" && stripeChargeable ? ("payment" as const) : ("request" as const),
    stripeChargeable,
  };
}

/** Whether customers can book at some hour: hours off (any time), or one open day. */
function hasBookableHours(settings: StoreSettings | null): boolean {
  const hours = settings?.businessHours;
  if (!hours?.enabled) return true;
  return Object.values(hours.schedule).some((day) => day.isOpen && day.ranges.length > 0);
}

/** The settings pages and editor sections the items link to. */
const ITEM_PAGES: Record<LaunchItemKey, string> = {
  storeInfo: "/dashboard/settings",
  contact: "/online-store/contact",
  products: "/dashboard/products",
  categories: "/dashboard/categories",
  pickup: "/dashboard/settings/delivery",
  businessHours: "/dashboard/settings/hours",
  terms: "/online-store/legal",
  legalNotice: "/online-store/legal",
  onlinePayments: "/dashboard/settings/payments",
  billing: "/dashboard/settings/billing",
  branding: "/online-store/identity",
};

type ItemFacts = Omit<LaunchItem, "key" | "links">;

const item = (done: boolean, ifDone: ItemFacts, ifNot: Partial<ItemFacts> = {}): ItemFacts =>
  done ? ifDone : { ...ifDone, ...ifNot };

/**
 * The checklist of a store, from its launch state. Pure: the dashboard's
 * home and the agents get the same items.
 */
export function buildLaunchChecklist(
  state: LaunchState,
  urls: UrlsPort,
): Omit<LaunchChecklistView, "storeId"> {
  const { store } = state;
  const settings = store.settings;
  const mode = bookingModeOf(store);
  const gateReason = state.gate.accepts ? null : state.gate.reason.replaceAll("_", " ");

  const storeInfoGaps = [!settings?.country && "country", !settings?.currency && "currency"].filter(
    (gap): gap is string => typeof gap === "string",
  );
  const hasContact = Boolean(store.email?.trim() || store.phone?.trim());
  const deliveryOn = settings?.delivery?.enabled === true;
  const hasPickup =
    Boolean(store.address?.trim()) ||
    (settings?.delivery?.multiLocationEnabled === true && state.hasActiveLocation);

  const facts: Record<LaunchItemKey, ItemFacts> = {
    storeInfo: item(
      storeInfoGaps.length === 0,
      {
        status: "done",
        required: true,
        title: "Store name, country and currency",
        why: "Customers see the name; every price is shown in the currency, and dates in the country's time zone.",
        tools: ["settings_update_store_info", "settings_update_company"],
      },
      {
        status: "missing",
        why: `The store has no ${storeInfoGaps.join(" and no ")}: prices and dates cannot be shown.`,
      },
    ),
    contact: item(
      hasContact,
      {
        status: "done",
        required: false,
        title: "Contact email or phone",
        why: "Customers reach the store with questions, and see how to contact it when it cannot take a booking.",
        tools: ["settings_update_store_info"],
      },
      {
        status: "missing",
        why: "The storefront shows no email or phone: customers cannot reach the store.",
      },
    ),
    products: item(
      state.hasPricedProduct,
      {
        status: "done",
        required: false,
        title: "An active product with a price",
        why: "Customers book products: the storefront lists the active ones.",
        tools: ["products_create", "products_update", "products_update_status"],
      },
      {
        status: "missing",
        why: "No active product with a price above zero: customers find nothing to book.",
      },
    ),
    categories: item(
      state.hasCategory,
      {
        status: "done",
        required: false,
        title: "Product categories",
        why: "Categories group the catalog, which helps once it holds more than a few products.",
        tools: ["categories_create"],
      },
      { status: "optional", why: "No category yet: the catalog shows one list." },
    ),
    pickup: item(
      hasPickup || deliveryOn,
      {
        status: "done",
        required: false,
        title: "Where customers collect their rental",
        why: "Customers pick up at the store's address or a pickup point, or get it delivered.",
        tools: [
          "settings_update_store_info",
          "settings_create_location",
          "settings_update_delivery",
        ],
      },
      {
        status: "missing",
        why: "The store has no address, no active pickup point and no delivery: customers do not know where to collect their rental.",
      },
    ),
    businessHours: item(
      hasBookableHours(settings),
      {
        status: "done",
        required: false,
        title: "Business hours",
        why: "Pickups and returns are booked within the business hours; without hours set, at any time.",
        tools: ["settings_update_business_hours"],
      },
      {
        status: "missing",
        why: "The business hours are on, with every day closed: no pickup time can be booked.",
      },
    ),
    terms: item(
      hasRichTextContent(store.cgv),
      {
        status: "done",
        required: false,
        title: "Terms and conditions",
        why: "Customers accept them at checkout, and they can be added to the rental contract.",
        tools: ["settings_update_legal"],
      },
      { status: "missing", why: "No terms and conditions: customers book without accepting any." },
    ),
    legalNotice: item(
      hasRichTextContent(store.legalNotice),
      {
        status: "done",
        required: false,
        title: "Legal notice",
        why: "Who runs the store (company, address, registration), which a business website must show in many countries.",
        tools: ["settings_update_legal"],
      },
      { status: "missing", why: "No legal notice on the storefront." },
    ),
    onlinePayments:
      mode.intended === "request"
        ? {
            status: mode.stripeChargeable ? "done" : "optional",
            required: false,
            title: "Online payments (Stripe)",
            why: "The store takes requests, which it accepts or refuses: it needs no Stripe. With Stripe, customers could pay at checkout (booking mode payment).",
            tools: [],
          }
        : item(
            mode.stripeChargeable,
            {
              status: "done",
              required: false,
              title: "Online payments (Stripe)",
              why: "Customers pay online at checkout.",
              tools: [],
            },
            {
              status: "missing",
              why: "The store wants online payment, but Stripe is not connected: until the user connects it in Louez (the dashboard link), customers send requests the store accepts or refuses. To take requests on purpose, set the booking mode to request (settings_update_reservation_rules).",
              tools: ["settings_update_reservation_rules"],
            },
          ),
    billing: item(
      state.gate.accepts,
      {
        status: "done",
        required: false,
        title: "Louez billing",
        why: "Louez billing lets the store take new bookings.",
        tools: [],
      },
      {
        status: "blocked",
        why: `Louez billing does not let the store take new bookings now (${gateReason}): the store owner fixes it in Louez billing (the dashboard link). The storefront can go live meanwhile; it tells customers it is not taking bookings.`,
      },
    ),
    branding: item(
      Boolean(store.logoUrl),
      {
        status: "done",
        required: false,
        title: "Logo and brand colour",
        why: "The storefront shows the store's logo and colour.",
        tools: [
          "online_store_create_image_upload",
          "online_store_complete_image_upload",
          "online_store_update_appearance",
        ],
      },
      { status: "optional", why: "No logo: the storefront shows the store's name instead." },
    ),
  };

  const linkStore = {
    id: store.id,
    slug: store.slug,
    onboardingCompleted: store.onboardingCompleted,
  };
  const items = LAUNCH_ITEM_KEYS.map(
    (key): LaunchItem => ({
      key,
      ...facts[key],
      links: { dashboard: urls.dashboard(dashboardPath(linkStore, ITEM_PAGES[key])) },
    }),
  );
  const blocking = items.filter((entry) => entry.required && entry.status !== "done");

  return {
    online: isStorefrontPublic(linkStore),
    storefrontUrl: urls.storefront(store.slug, "/"),
    canGoLive: blocking.length === 0,
    blocking: blocking.map((entry) => entry.key),
    bookingMode: mode,
    items,
    milestones: state.milestones,
    links: storeLinks(urls, linkStore),
  };
}

/** The checklist of the actor's store, as it is now. */
export async function getLaunchChecklist(
  storeId: string,
  options: { urls: UrlsPort; withMilestones: boolean },
): Promise<LaunchChecklistView> {
  const state = await readLaunchState(db, storeId, { withMilestones: options.withMilestones });
  return { storeId, ...buildLaunchChecklist(state, options.urls) };
}

// --- Going live -------------------------------------------------------------

/** What going live shows before it runs, read under the store's lock. */
export interface GoLivePreview {
  summary: string;
  storefrontUrl: string;
  bookingMode: ReturnType<typeof bookingModeOf>;
  /** Each item's status: a change since the preview voids its token. */
  statuses: Partial<Record<LaunchItemKey, LaunchItemStatus>>;
  /** What customers will see, in a few sentences. */
  customersWillSee: string[];
  stillMissing: Array<Pick<LaunchItem, "key" | "title" | "why">>;
  optional: Array<Pick<LaunchItem, "key" | "title">>;
}

export interface LaunchActor extends SettingsActor {
  userId: string;
  transport: Transport;
}

/** The settings a store takes with it online, the onboarding's defaults first. */
const LAUNCH_SETTINGS_DEFAULTS = {
  minRentalMinutes: 60,
  maxRentalMinutes: null,
  advanceNoticeMinutes: 1440,
  turnoverBufferMinutes: 0,
} satisfies Partial<StoreSettings>;

function describeLaunch(
  checklist: ReturnType<typeof buildLaunchChecklist>,
  intended: "payment" | "request",
  store: LaunchStoreRow,
): GoLivePreview {
  const bookingMode = bookingModeOf(store, intended);
  const open = checklist.items.filter((entry) => entry.status !== "done");
  const stillMissing = open
    .filter((entry) => entry.status === "missing" || entry.status === "blocked")
    .map(({ key, title, why }) => ({ key, title, why }));
  const optional = open
    .filter((entry) => entry.status === "optional")
    .map(({ key, title }) => ({ key, title }));
  const byKey = new Map(checklist.items.map((entry) => [entry.key, entry]));
  const customersWillSee = [
    `The storefront of "${store.name}" opens at ${checklist.storefrontUrl}, and search engines may list it.`,
    bookingMode.effective === "payment"
      ? "Customers book and pay online at checkout."
      : bookingMode.intended === "payment"
        ? "Customers send booking requests the store accepts or refuses: Stripe is not connected yet, so online payment starts once it is."
        : "Customers send booking requests the store accepts or refuses.",
    byKey.get("products")?.status === "done"
      ? "The active products are listed with their prices."
      : "The catalog is empty: no product can be booked yet.",
    ...(byKey.get("billing")?.status === "blocked"
      ? ["The storefront says the store is not taking bookings, until Louez billing is fixed."]
      : []),
  ];
  const statuses: Partial<Record<LaunchItemKey, LaunchItemStatus>> = {};
  for (const entry of checklist.items) statuses[entry.key] = entry.status;
  return {
    summary:
      `Put "${store.name}" online at ${checklist.storefrontUrl}: customers can find the store and book.` +
      (stillMissing.length > 0
        ? ` Still missing: ${stillMissing.map((entry) => entry.title.toLowerCase()).join(", ")}.`
        : ""),
    storefrontUrl: checklist.storefrontUrl,
    bookingMode,
    statuses,
    customersWillSee,
    stillMissing,
    optional,
  };
}

/** An effect must never fail a write that has committed. */
function emit(actor: SettingsActor, event: ApiEvent) {
  try {
    actor.afterCommit(event);
  } catch (error) {
    console.error("A launch effect failed after its commit:", error);
  }
}

export interface GoLiveResult {
  launched: boolean;
  checklist: ReturnType<typeof buildLaunchChecklist>;
  bookingMode: ReturnType<typeof bookingModeOf>;
  effectIds: string[];
}

/**
 * Puts the store online, as the onboarding's last step always did: the
 * onboarding's default rules where the store has none, the booking mode, and
 * `onboardingCompleted`, which opens the storefront. In the outbox, in the
 * same transaction: the platform's notification (Discord, fromHello) and the
 * analytics event. Refused while a required item is missing.
 *
 * Under the store row's lock, taken first: two launches at once run one after
 * the other, and the second finds the store online. Product and category
 * writes lock the same row first, so the checklist read under it is the one
 * that goes live. A store already online is not launched again: its booking
 * mode changes when the caller sends another one, and nothing else happens.
 */
export async function goLive(
  actor: LaunchActor,
  input: GoLiveInput,
  options: { urls: UrlsPort; confirm?: ConfirmStep<GoLivePreview> },
): Promise<GoLiveResult> {
  const { storeId } = actor;
  let refusal: Error | null = null;

  const result = await db.transaction(async (tx) => {
    if (!(await lockStoreRow(tx, storeId))) throw platformErrors.noStore();
    const state = await readLaunchState(tx, storeId, { withMilestones: false });
    const { store } = state;
    const checklist = buildLaunchChecklist(state, options.urls);
    const current = bookingModeOf(store);
    const intended = input.reservationMode ?? current.intended;

    if (checklist.online) {
      if (intended === current.intended) {
        return {
          launched: false,
          checklist,
          bookingMode: current,
          effectIds: [],
          slug: store.slug,
          modeChanged: false,
        };
      }
      // Online already: only the booking mode changes.
      if (options.confirm) {
        const next = bookingModeOf(store, intended);
        refusal = await options.confirm(
          {
            ...describeLaunch(checklist, intended, store),
            summary: `The store is online already. Change how customers book from ${current.intended} to ${intended}${next.effective !== intended ? ` (customers send requests until Stripe is connected)` : ""}.`,
          },
          tx,
        );
        if (refusal) return null;
      }
      const settings: StoreSettings = {
        ...LAUNCH_SETTINGS_DEFAULTS,
        ...store.settings,
        reservationMode: intended,
      };
      await tx
        .update(stores)
        .set({ settings, updatedAt: new Date() })
        .where(eq(stores.id, storeId));
      await markStore(tx, storeId);
      return {
        launched: false,
        checklist: buildLaunchChecklist({ ...state, store: { ...store, settings } }, options.urls),
        bookingMode: bookingModeOf(store, intended),
        effectIds: [],
        slug: store.slug,
        modeChanged: true,
      };
    }

    const blocking = checklist.items.filter((entry) => entry.required && entry.status !== "done");
    if (blocking.length > 0) throw launchErrors.notReady(blocking);

    if (options.confirm) {
      refusal = await options.confirm(describeLaunch(checklist, intended, store), tx);
      if (refusal) return null;
    }

    const settings: StoreSettings = {
      ...LAUNCH_SETTINGS_DEFAULTS,
      ...store.settings,
      reservationMode: intended,
    };
    await tx
      .update(stores)
      .set({ settings, onboardingCompleted: true, updatedAt: new Date() })
      .where(eq(stores.id, storeId));
    // onboardingCompleted and the settings are in the store's billing snapshot.
    await markStore(tx, storeId);

    const launchedStore = { id: storeId, name: store.name, slug: store.slug };
    const effectIds = await enqueueEffects(tx, storeId, [
      { type: "store.launchNotification", payload: { channel: "discord", store: launchedStore } },
      { type: "store.launchNotification", payload: { channel: "fromhello", store: launchedStore } },
      {
        type: "store.launchAnalytics",
        payload: {
          ...analyticsEventIdentity(new Date()),
          ownerUserId: actor.store.ownerUserId,
          storeId,
          reservationMode: intended,
          transport: actor.transport,
        },
      },
    ]);

    return {
      launched: true,
      checklist: buildLaunchChecklist(
        { ...state, store: { ...store, settings, onboardingCompleted: true } },
        options.urls,
      ),
      bookingMode: bookingModeOf(store, intended),
      effectIds,
      slug: store.slug,
      modeChanged: false,
    };
  });

  if (refusal) throw refusal;
  if (!result) throw platformErrors.noStore();

  const store = { ...actor.store, slug: result.slug };
  if (result.launched) emit(actor, { type: "store.launched", store });
  if (result.modeChanged)
    emit(actor, { type: "store.settingsUpdated", store, section: "reservationRules" });
  return {
    launched: result.launched,
    checklist: result.checklist,
    bookingMode: result.bookingMode,
    effectIds: result.effectIds,
  };
}
