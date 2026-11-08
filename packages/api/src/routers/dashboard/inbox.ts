import {
  INBOX_ACKNOWLEDGE_MAX,
  INBOX_PAGE_DEFAULT,
  INBOX_PAGE_MAX,
  INBOX_POLL_MINUTES,
  acknowledgeInboxInput,
  acknowledgeInboxOutput,
  listInboxInput,
  listInboxOutput,
  type InboxItemType,
} from "../../contracts/inbox";
import { allows, type ApiDomain } from "../../platform/permissions";
import { storeProcedure } from "../../platform/procedures";
import {
  INBOX_HOLD_BACK_MS,
  INBOX_ITEM_DOMAINS,
  acknowledgeInbox,
  listInbox,
  mayShow,
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
] as const satisfies readonly ApiDomain[];

const reads = (context: ProductContext): InboxRights =>
  Object.fromEntries(READ_DOMAINS.map((domain) => [domain, mayRead(context, domain)]));

const OPENED_BY = ["settings", "integrations"] as const satisfies readonly ApiDomain[];

const list = storeProcedure
  .meta({
    capability: "inbox.list",
    scope: { domain: "reservations", level: "read", anyOf: OPENED_BY },
    mcp: {
      name: "inbox_list",
      description: `What needs the store's attention now: booking requests to answer, return-date requests, late pickups and returns, deposit holds about to expire, failed payments, open disputes, bookings on a retired or out-of-service unit, overbookings, supplier invoices and rejected e-invoices, Louez billing stopping new bookings, a store not online yet, messages that never went out, and API calls whose outcome is unknown. Each item has a type, a severity (critical, warning, info), occurredAt, one sentence to tell the user, the reservation it is about, the facts behind it, the tools that act on it (none when only the user can, in Louez) and \`links\` to give the user.

Polling: call it every ${INBOX_POLL_MINUTES.min} to ${INBOX_POLL_MINUTES.max} minutes. The first call, without cursor, returns the whole inbox, oldest first. Keep the nextCursor of each answer and pass it as cursor on the next call: you get only the items that entered the inbox since, in the order they did. When hasMore is true, call again at once with nextCursor. Calls are read-only: repeating one with the same cursor returns the same items, minus those handled since. An item shows ${INBOX_HOLD_BACK_MS / 1000} seconds after it happens. An item leaves the inbox once what it is about is handled (the request answered, the reservation returned); the same id with a later occurredAt means it came back. inbox_acknowledge hides an item for the whole store. Up to ${INBOX_PAGE_MAX} items a call (default ${INBOX_PAGE_DEFAULT}). A connection over several stores calls it once per store, with storeId. Items need read access to what they show: payments for payment items, customers for names.`,
      bundle: "daily",
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
  })
  .route({ method: "GET", path: "/inbox" })
  .input(listInboxInput)
  .output(listInboxOutput)
  .handler(({ context, input }) => {
    const { credential } = context.actor;
    return listInbox(
      {
        store: context.store,
        urls: context.ports.urls,
        hostedBy: context.ports.hostedBy?.() ?? null,
        reads: reads(context),
        operationsOf: credential.kind === "session" ? null : (credential.id ?? credential.userId),
      },
      input,
    );
  });

const acknowledge = storeProcedure
  .meta({
    capability: "inbox.acknowledge",
    scope: { domain: "reservations", level: "write", anyOf: OPENED_BY },
    mcp: {
      name: "inbox_acknowledge",
      description: `Mark inbox items as handled, for the whole store: they leave inbox_list for every member and agent. Pass each item's id and occurredAt as inbox_list returned them, up to ${INBOX_ACKNOWLEDGE_MAX} at once. An item that comes back later (the same id, a later occurredAt) shows again. Marking an item twice changes nothing. Use it when the user says they dealt with something, not instead of acting on it: an item whose record is handled leaves the inbox by itself. Needs write access to the item's first domain.`,
      bundle: "daily",
      annotations: { idempotentHint: true },
    },
  })
  .route({ method: "POST", path: "/inbox/acknowledge" })
  .input(acknowledgeInboxInput)
  .output(acknowledgeInboxOutput)
  .handler(({ context, input }) => {
    const { actor } = context;
    const rights = reads(context);
    const mayWrite = (domain: ApiDomain) =>
      allows(actor.role, actor.credential.scopes, { domain, level: "write" });
    return acknowledgeInbox(
      {
        storeId: actor.storeId,
        userId: actor.credential.userId,
        credentialId: actor.credential.id,
        clientName: actor.credential.clientName,
        may: (type: InboxItemType) => {
          const [first] = INBOX_ITEM_DOMAINS[type];
          return (
            mayShow(rights, type) &&
            (first ? mayWrite(first) : mayWrite("reservations") || OPENED_BY.some(mayWrite))
          );
        },
      },
      input,
    );
  });

export const dashboardInboxRouter = { list, acknowledge };
