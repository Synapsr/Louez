import { z } from "zod";

import { apiError } from "../platform/errors";
import { resourceLinksSchema } from "./links";

/**
 * The inbox: what needs the store's attention now, for the owner, the team
 * and their agents. One list, read with a cursor, so an agent that polls gets
 * only what is new (services/inbox.ts).
 */

/** What an item is about. */
export const INBOX_ITEM_TYPES = [
  /** A booking request waiting for the store's answer. */
  "booking_request",
  /** A customer asks to bring the rental back on another date. */
  "date_change_request",
  /** A confirmed reservation past its start, not marked picked up. */
  "pickup_overdue",
  /** An ongoing reservation past its end, not marked returned. */
  "return_overdue",
  /** A deposit hold that expires within two days, or has expired. */
  "deposit_expiring",
  /** An online payment or a deposit hold that failed, not made good since. */
  "payment_failed",
  /** A deposit authorization the store asked for, which Stripe has not confirmed after 15 minutes. */
  "deposit_unconfirmed",
  /** A second deposit authorization Louez could not cancel at Stripe: the card is still held. */
  "deposit_release_failed",
  /** A Stripe dispute (chargeback) still open. */
  "dispute_open",
  /** A booking holds a unit that is retired or out of service over its dates. */
  "unit_conflict",
  /** A booking created over the available stock. */
  "overbooking",
  /** A supplier invoice received through electronic invoicing, not handled yet. */
  "supplier_invoice",
  /** A customer invoice the electronic invoicing network rejected, or that never reached it. */
  "einvoice_rejected",
  /** Louez billing stops new bookings until the owner acts in the billing page. */
  "billing_gate_closed",
  /** The store is not online yet. */
  "store_not_live",
  /** A message to a customer, or a store notification, that never went out. */
  "message_not_sent",
  /** A write through the API whose outcome is unknown: check before retrying. */
  "operation_unknown",
  /** A step handed to the user (Stripe, the billing card, a team invitation's approval) waiting for an hour, expired or failed. */
  "handoff_waiting",
  /** A team invitation's e-mail that never went out, for an invitation still pending. */
  "invitation_not_sent",
  /** An AI photo enhancement or background removal that failed (nothing was charged). */
  "image_job_failed",
] as const;
export type InboxItemType = (typeof INBOX_ITEM_TYPES)[number];

export const INBOX_SEVERITIES = ["critical", "warning", "info"] as const;
export type InboxSeverity = (typeof INBOX_SEVERITIES)[number];

export const INBOX_PAGE_DEFAULT = 50;
export const INBOX_PAGE_MAX = 100;
/** Items one acknowledge call takes. */
export const INBOX_ACKNOWLEDGE_MAX = 100;

const cursorInput = z
  .string()
  .min(1)
  // Longer while some types stand behind (a source that failed): at most one position per type.
  .max(4_000)
  .describe(
    "The nextCursor of the previous call. Leave it out to read the whole inbox from the oldest item.",
  );

export const listInboxInput = z.object({
  cursor: cursorInput.optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(INBOX_PAGE_MAX)
    .optional()
    .describe(`Items per call (default ${INBOX_PAGE_DEFAULT}, at most ${INBOX_PAGE_MAX}).`),
});
export type ListInboxInput = z.infer<typeof listInboxInput>;

/** A fact of an item: plain values only, so every transport carries them as they are. */
const detailValue = z.union([z.string(), z.number(), z.boolean(), z.null()]);

export const inboxItemSchema = z.object({
  id: z
    .string()
    .describe(
      "The item: its type and its record, `<type>:<recordId>`. The same thing keeps its id; acknowledge takes it with occurredAt.",
    ),
  type: z.enum(INBOX_ITEM_TYPES),
  severity: z.enum(INBOX_SEVERITIES),
  occurredAt: z
    .date()
    .describe(
      "When the item entered the inbox: the request was made, the return became late, the payment failed. Items come in this order.",
    ),
  summary: z.string().describe("One sentence for the user, in English."),
  /** The reservation the item is about, when it is one. */
  reservation: z
    .object({
      id: z.string(),
      number: z.string(),
      startDate: z.date(),
      endDate: z.date(),
      /** Null without read access to customers. */
      customerName: z.string().nullable(),
    })
    .nullable(),
  details: z
    .record(z.string(), detailValue)
    .describe("The facts behind the summary: ids, dates as ISO strings, amounts with currency."),
  tools: z
    .array(z.string())
    .describe(
      "The tools that act on it. Empty when only the user can, in Louez: give them the link.",
    ),
  links: resourceLinksSchema,
});
export type InboxItem = z.infer<typeof inboxItemSchema>;

export const listInboxOutput = z.object({
  items: z.array(inboxItemSchema),
  nextCursor: z
    .string()
    .describe("Pass it as cursor on the next call to get only what came in since."),
  hasMore: z.boolean().describe("More items wait: call again at once with nextCursor."),
  unavailable: z
    .array(z.enum(INBOX_ITEM_TYPES))
    .optional()
    .describe(
      "Present when Louez could not read some item types this time: the answer lacks their items, so tell the user the inbox is incomplete. nextCursor keeps their place: a later call with it brings them once Louez reads them again, with their own, earlier occurredAt.",
    ),
});

export const acknowledgeInboxInput = z.object({
  items: z
    .array(
      z.object({
        id: z.string().min(3).max(120).describe("An item's id, as inbox_list returned it."),
        occurredAt: z.coerce.date().describe("The item's occurredAt, as inbox_list returned it."),
      }),
    )
    .min(1)
    .max(INBOX_ACKNOWLEDGE_MAX),
});

export const acknowledgeInboxOutput = z.object({
  acknowledged: z.number().int().describe("Items marked handled by this call."),
  alreadyAcknowledged: z.number().int().describe("Items marked before."),
  rejected: z
    .array(
      z.object({
        id: z.string(),
        occurredAt: z.date().describe("The occurredAt sent."),
        currentOccurredAt: z
          .date()
          .nullable()
          .describe(
            "The occurrence the inbox holds now for this item: send it again with this occurredAt if the user means it. Null: the item left the inbox (handled, or no longer true); drop it.",
          ),
      }),
    )
    .describe(
      "Items not in the inbox now with the occurredAt sent, left unmarked. To start again from what the inbox holds, call inbox_list without a cursor.",
    ),
});

export const inboxErrors = {
  invalidCursor: () =>
    apiError("BAD_REQUEST", "INVALID_CURSOR", {
      message: "This cursor is not one inbox_list returned. Start again without a cursor.",
      i18nKey: "errors.invalidData",
    }),
  invalidItem: (id: string) =>
    apiError("BAD_REQUEST", "INBOX_ITEM_INVALID", {
      message: `"${id}" is not an inbox item id: pass the id inbox_list returned.`,
      i18nKey: "errors.invalidData",
      details: { id },
    }),
} as const;
