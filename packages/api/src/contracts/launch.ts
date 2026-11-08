import { z } from "zod";

import { apiError } from "../platform/errors";
import { resourceLinksSchema } from "./links";

/**
 * A store's launch: what it still lacks before customers can book, and its
 * going live, the onboarding's last step. No database here.
 */

/** Every item of the checklist, in the order it is shown. */
export const LAUNCH_ITEM_KEYS = [
  "storeInfo",
  "contact",
  "products",
  "categories",
  "pickup",
  "businessHours",
  "terms",
  "legalNotice",
  "onlinePayments",
  "billing",
  "branding",
] as const;
export type LaunchItemKey = (typeof LAUNCH_ITEM_KEYS)[number];

/**
 * - `done`: in place.
 * - `missing`: not in place, and customers will miss it (a `required` one stops the launch).
 * - `optional`: not in place, and the store works well without it.
 * - `blocked`: something outside the store's settings stops bookings (billing); the user fixes it in Louez.
 */
export const LAUNCH_ITEM_STATUSES = ["done", "missing", "optional", "blocked"] as const;
export type LaunchItemStatus = (typeof LAUNCH_ITEM_STATUSES)[number];

export const launchItemSchema = z.object({
  key: z.enum(LAUNCH_ITEM_KEYS),
  status: z.enum(LAUNCH_ITEM_STATUSES),
  /** True: the store cannot go live while this item is missing. */
  required: z.boolean(),
  /** What the item is, in a few words. */
  title: z.string(),
  /** Why it matters to customers, and what is missing when it is. */
  why: z.string(),
  /** The tools that fix it; empty when only the user can, in Louez (the dashboard link). */
  tools: z.array(z.string()),
  /** The dashboard page where the user sees or fixes it. */
  links: resourceLinksSchema,
});
export type LaunchItem = z.infer<typeof launchItemSchema>;

export const reservationModeSchema = z.enum(["payment", "request"]);

/** How the storefront takes a booking: the mode the store chose, and what it does now. */
export const bookingModeSchema = z.object({
  /** What the store chose: online payment at checkout, or requests it accepts. */
  intended: reservationModeSchema,
  /** What the storefront does now: payment needs Stripe, so without it customers send requests. */
  effective: reservationModeSchema,
  /** Whether Stripe takes payments for this store. */
  stripeChargeable: z.boolean(),
});

export const getLaunchChecklistInput = z.object({});

export const launchChecklistOutput = z.object({
  storeId: z.string(),
  /** True once the store is live: its storefront is public. */
  online: z.boolean(),
  /** The storefront's public address: live once online, the future one before. */
  storefrontUrl: z.string(),
  /** Whether stores_go_live would put the store live now (no required item missing). */
  canGoLive: z.boolean(),
  /** The keys of the required items still missing. */
  blocking: z.array(z.enum(LAUNCH_ITEM_KEYS)),
  bookingMode: bookingModeSchema,
  items: z.array(launchItemSchema),
  /**
   * The first bookings, as the dashboard's home follows them; null when the
   * connection may not read reservations.
   */
  milestones: z
    .object({ firstReservation: z.boolean(), firstCompletedReservation: z.boolean() })
    .nullable(),
  /** The store's dashboard and, once online, its storefront. */
  links: resourceLinksSchema,
});
export type LaunchChecklistView = z.infer<typeof launchChecklistOutput>;

export const goLiveInput = z.object({
  reservationMode: reservationModeSchema
    .optional()
    .describe(
      "How customers book: payment (they pay online at checkout; without Stripe connected they send requests until it is) or request (they send a request the store accepts or refuses). Leave it out to keep the store's choice.",
    ),
});
export type GoLiveInput = z.infer<typeof goLiveInput>;

export const goLiveOutput = z.object({
  storeId: z.string(),
  online: z.literal(true),
  /** False when the store was live already: nothing was launched again. */
  launched: z.boolean(),
  /** The storefront's public address, open to customers. */
  storefrontUrl: z.string(),
  bookingMode: bookingModeSchema,
  /** The items still missing or optional: worth finishing now that customers can come. */
  remaining: z.array(launchItemSchema),
  /** The store's dashboard and its storefront, now public. */
  links: resourceLinksSchema,
});

export const launchErrors = {
  notReady: (blocking: readonly LaunchItem[]) =>
    apiError("PRECONDITION_FAILED", "STORE_NOT_READY", {
      message: `The store cannot go live yet: ${blocking.map((item) => `${item.title} (${item.why})`).join("; ")}. Fix these with the tools listed in details, then call again.`,
      i18nKey: "errors.storeNotReady",
      details: {
        blocking: blocking.map(({ key, title, why, tools }) => ({ key, title, why, tools })),
      },
    }),
} as const;
