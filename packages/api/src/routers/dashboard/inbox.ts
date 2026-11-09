import type { HandoffKind } from "../../contracts/handoffs";
import {
  INBOX_ACKNOWLEDGE_MAX,
  INBOX_PAGE_DEFAULT,
  INBOX_PAGE_MAX,
  acknowledgeInboxInput,
  acknowledgeInboxOutput,
  listInboxInput,
  listInboxOutput,
  type InboxItemType,
} from "../../contracts/inbox";
import { allows, type ApiDomain } from "../../platform/permissions";
import { storeProcedure } from "../../platform/procedures";
import { HANDOFF_KIND_DOMAINS } from "../../services/handoffs";
import {
  INBOX_ACKNOWLEDGEMENT_RETENTION_DAYS,
  INBOX_HOLD_BACK_MS,
  INBOX_ITEM_DOMAINS,
  acknowledgeInbox,
  listInbox,
  mayShow,
  type InboxReader,
  type InboxRights,
} from "../../services/inbox";
import { mayRead, type ProductContext } from "./product-context";

/**
 * The inbox, on every transport: `inbox_list` and `inbox_acknowledge` on MCP,
 * `/api/v1/inbox` on OpenAPI. The logic is in services/inbox.ts.
 *
 * It opens to a caller who may read reservations, settings or integrations,
 * and shows each type of item only to a caller who may read what it shows
 * (INBOX_ITEM_DOMAINS): without customers, no customer's name; without
 * payments, no payment item; without reservations, no reservation item.
 */

const READ_DOMAINS = [
  "reservations",
  "customers",
  "payments",
  "products",
  "settings",
  "integrations",
  "billing",
  "team",
] as const satisfies readonly ApiDomain[];

const reads = (context: ProductContext): InboxRights =>
  Object.fromEntries(READ_DOMAINS.map((domain) => [domain, mayRead(context, domain)]));

/** Beside reservations, the domains whose read shows an item on their own. */
const OPENED_BY = [
  "settings",
  "integrations",
  "billing",
  "team",
] as const satisfies readonly ApiDomain[];
/**
 * Beside reservations, every domain an item type is acknowledged under (its
 * first, INBOX_ITEM_DOMAINS): a key that may change payments acknowledges a
 * failed payment it reads.
 */
const ACKNOWLEDGED_UNDER = [
  "payments",
  "settings",
  "integrations",
  "billing",
  "team",
] as const satisfies readonly ApiDomain[];

const readerOf = (context: ProductContext): InboxReader => {
  const { credential } = context.actor;
  return {
    store: context.store,
    urls: context.ports.urls,
    hostedBy: context.ports.hostedBy?.() ?? null,
    reads: reads(context),
    operationsOf: credential.kind === "session" ? null : (credential.id ?? credential.userId),
  };
};

const list = storeProcedure
  .meta({
    capability: "inbox.list",
    scope: { domain: "reservations", level: "read", anyOf: OPENED_BY },
    mcp: {
      name: "inbox_list",
      title: "List Inbox",
      description: `What needs the store's attention now: booking requests to answer, return-date requests, late pickups and returns, deposit holds about to expire, failed payments, open disputes, bookings on a retired or out-of-service unit, overbookings, supplier invoices and rejected e-invoices, Louez billing stopping new bookings, a store not online yet, messages that never went out, API calls whose outcome is unknown, and steps handed to the user (Stripe, the billing card) still waiting an hour after their link, expired or failed. Each item has a type, a severity (critical, warning, info), occurredAt, one sentence to tell the user, the reservation it is about, the facts behind it, the tools that act on it (none when only the user can, in Louez) and \`links\` to give the user.

Without cursor, it returns the whole inbox, oldest first. With the nextCursor of an earlier answer as cursor, it returns only the items that entered the inbox since, in the order they did; hasMore true means more wait at the new nextCursor. Calls are read-only: repeating one with the same cursor returns the same items, minus those handled since. An item shows ${INBOX_HOLD_BACK_MS / 1000} seconds after it happens. An item leaves the inbox once what it is about is handled (the request answered, the reservation returned); the same id with a later occurredAt means it came back. inbox_acknowledge hides an item for the whole store. Up to ${INBOX_PAGE_MAX} items a call (default ${INBOX_PAGE_DEFAULT}). It reads one store (storeId). Items need read access to what they show: payments for payment items, customers for names.`,
      bundle: "daily",
      annotations: { idempotentHint: true },
    },
  })
  .route({ method: "GET", path: "/inbox" })
  .input(listInboxInput)
  .output(listInboxOutput)
  .handler(({ context, input }) => listInbox(readerOf(context), input));

const acknowledge = storeProcedure
  .meta({
    capability: "inbox.acknowledge",
    scope: { domain: "reservations", level: "write", anyOf: ACKNOWLEDGED_UNDER },
    mcp: {
      name: "inbox_acknowledge",
      title: "Mark Inbox Items Handled",
      description: `Mark inbox items as handled, for the whole store: they leave inbox_list for every member and agent. Takes each item's id and occurredAt as inbox_list returned them, up to ${INBOX_ACKNOWLEDGE_MAX} at once. An item that comes back later (the same id, a later occurredAt) shows again. Items not in the inbox now with that occurredAt are left unmarked and come back in rejected: with currentOccurredAt when the inbox holds the item with another occurrence (send that one if the user means it), null when it left the inbox (handled: drop it). After a rejection, inbox_list without a cursor gives what the inbox holds now. Marking an item twice changes nothing. A mark is kept ${INBOX_ACKNOWLEDGEMENT_RETENTION_DAYS} days: an item still open after that shows again. It is for what the user dealt with: an item whose record is handled leaves the inbox by itself. Needs write access to the item's first domain.`,
      bundle: "daily",
      effect: "overwrite",
      annotations: { idempotentHint: true },
    },
  })
  .route({ method: "POST", path: "/inbox/acknowledge" })
  .input(acknowledgeInboxInput)
  .output(acknowledgeInboxOutput)
  .handler(({ context, input }) => {
    const { actor } = context;
    const reader = readerOf(context);
    const mayWrite = (domain: ApiDomain) =>
      allows(actor.role, actor.credential.scopes, { domain, level: "write" });
    return acknowledgeInbox(
      reader,
      {
        storeId: actor.storeId,
        userId: actor.credential.userId,
        credentialId: actor.credential.id,
        clientName: actor.credential.clientName,
        may: (type: InboxItemType) => {
          const [first] = INBOX_ITEM_DOMAINS[type];
          return (
            mayShow(reader.reads, type) &&
            (first
              ? mayWrite(first)
              : mayWrite("reservations") || ACKNOWLEDGED_UNDER.some(mayWrite))
          );
        },
        // A handoff is acknowledged under its kind's domain.
        refusedFor: (item) => {
          if (item.type !== "handoff_waiting") return null;
          const kind = item.details.kind as HandoffKind;
          const domain = HANDOFF_KIND_DOMAINS[kind];
          return domain && !mayWrite(domain) ? domain : null;
        },
      },
      input,
    );
  });

export const dashboardInboxRouter = { list, acknowledge };
