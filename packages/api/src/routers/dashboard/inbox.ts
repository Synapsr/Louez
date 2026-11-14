import type { StepKind } from "../../contracts/handoffs";
import {
  INBOX_ACKNOWLEDGE_MAX,
  INBOX_ITEM_TYPES,
  INBOX_PAGE_DEFAULT,
  INBOX_PAGE_MAX,
  acknowledgeInboxInput,
  acknowledgeInboxOutput,
  listInboxInput,
  listInboxOutput,
  type InboxItemType,
} from "../../contracts/inbox";
import { API_DOMAINS, allows, type ApiDomain } from "../../platform/permissions";
import { storeProcedure } from "../../platform/procedures";
import { withheldProcedurePaths } from "../../platform/withheld-procedures";
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
 * It shows the whole inbox to a caller who may read reservations, settings,
 * integrations, billing or the team, and each type of item only to a caller
 * who may read what it shows (INBOX_ITEM_DOMAINS): without customers, no
 * customer's name; without payments, no payment item; without reservations,
 * no reservation item. It also opens to a caller who reads any other domain,
 * for the approvals of that domain alone (`listedTypes`), as an approval
 * belongs to its procedure's domain, which can be any.
 */

/** What the caller reads, domain by domain: every domain, as an approval shows by its procedure's. */
const reads = (context: ProductContext): InboxRights =>
  Object.fromEntries(API_DOMAINS.map((domain) => [domain, mayRead(context, domain)]));

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

/** Every domain but reservations: each opens the inbox, for its approvals at least. */
const ANY_OTHER_DOMAIN = API_DOMAINS.filter((domain) => domain !== "reservations");

/**
 * The types a caller lists: each type whose domains it reads, as before
 * approvals, for a caller the inbox opened to then (reservations or
 * `OPENED_BY` read); an approval for any caller, by its domain and whose it
 * is (`connectionReadsApproval`, in its source). So a caller that reads only
 * another domain lists its approvals, and nothing else.
 */
export function listedTypes(reads: InboxRights): InboxItemType[] {
  const opensWholeInbox = reads.reservations === true || OPENED_BY.some((domain) => reads[domain]);
  return INBOX_ITEM_TYPES.filter(
    (type) => mayShow(reads, type) && (type === "approval_waiting" || opensWholeInbox),
  );
}

/**
 * Whether a caller acknowledges items of a type: one whose domains it reads,
 * with write access to the type's first domain, as before approvals, for a
 * caller that acknowledged then (reservations or `ACKNOWLEDGED_UNDER` write). An
 * approval is acknowledged with write access to its procedure's domain, as
 * any item is to its own (`refusedFor`), whatever else the caller writes.
 */
export function acknowledgesType(
  type: InboxItemType,
  reads: InboxRights,
  mayWrite: (domain: ApiDomain) => boolean,
): boolean {
  if (!mayShow(reads, type)) return false;
  if (type === "approval_waiting") return true;
  if (!(mayWrite("reservations") || ACKNOWLEDGED_UNDER.some(mayWrite))) return false;
  const [first] = INBOX_ITEM_DOMAINS[type];
  return first ? mayWrite(first) : true;
}

const readerOf = async (context: ProductContext): Promise<InboxReader> => {
  const { credential } = context.actor;
  return {
    store: context.store,
    urls: context.ports.urls,
    hostedBy: context.ports.hostedBy?.() ?? null,
    reads: reads(context),
    types: listedTypes(reads(context)),
    operationsOf: credential.kind === "session" ? null : (credential.id ?? credential.userId),
    ...(credential.kind === "session"
      ? {}
      : { connection: { kind: credential.kind, id: credential.id } }),
    withheld: credential.withheld?.capabilities,
    withheldProcedures: await withheldProcedurePaths(credential.withheld),
    log: context.ports.log,
  };
};

const list = storeProcedure
  .meta({
    capability: "inbox.list",
    // Any domain's read opens it; the handler shows only the types the caller lists (`listedTypes`).
    scope: { domain: "reservations", level: "read", anyOf: ANY_OTHER_DOMAIN },
    mcp: {
      name: "inbox_list",
      title: "List Inbox",
      description: `What needs the store's attention now: booking requests to answer, return-date requests, late pickups and returns, deposit holds about to expire, failed payments, open disputes, bookings on a retired or out-of-service unit, overbookings, supplier invoices and rejected e-invoices, Louez billing stopping new bookings, a store not online yet, messages that never went out, API calls whose outcome is unknown, and steps handed to the user (such as Stripe's onboarding) still waiting an hour after their link, expired or failed. Each item has a type, a severity (critical, warning, info), occurredAt, one sentence to tell the user, the reservation it is about, the facts behind it, the tools that act on it (none when only the user can, in Louez) and \`links\` to give the user.

Without cursor, it returns the whole inbox, oldest first. With the nextCursor of an earlier answer as cursor, it returns only the items that entered the inbox since, in the order they did; hasMore true means more wait at the new nextCursor. Calls are read-only: repeating one with the same cursor returns the same items, minus those handled since. An item shows ${INBOX_HOLD_BACK_MS / 1000} seconds after it happens. An item leaves the inbox once what it is about is handled (the request answered, the reservation returned); the same id with a later occurredAt means it came back. inbox_acknowledge hides an item for the whole store. When Louez cannot read some item types, the others still come and \`unavailable\` names the missing ones; their items come with a later call with nextCursor, late but not lost, while the other types are not given again. Up to ${INBOX_PAGE_MAX} items a call (default ${INBOX_PAGE_DEFAULT}). It reads one store (storeId). Items need read access to what they show: payments for payment items, customers for names.`,
      bundle: "daily",
      annotations: { idempotentHint: true },
    },
  })
  .route({
    method: "GET",
    path: "/inbox",
    description: [
      "Lists what needs the store's attention now: booking requests to answer, return-date requests, late pickups and returns, deposit holds about to expire, failed payments, open disputes, bookings on a retired or out-of-service unit, overbookings, supplier invoices and rejected e-invoices, Louez billing stopping new bookings, a store not online yet, messages and invitation e-mails that never went out, the key's own writes whose outcome is unknown, and steps taken in a browser (such as Stripe's onboarding) still waiting an hour after their link went out, expired or failed. Each item has an `id`, a `type`, a `severity` (`critical`, `warning` or `info`), `occurredAt`, a one-sentence `summary`, the `reservation` it is about, the facts behind it in `details`, the operations that act on it by `operationId` (none when only a person can, in the Louez dashboard) and `links.dashboard`.",
      "",
      `Without \`cursor\`, it returns the whole inbox, oldest first. With the \`nextCursor\` of an earlier answer as \`cursor\`, it returns only the items that entered the inbox since, in the order they did; \`hasMore: true\` means more wait at the new \`nextCursor\`. It only reads: the same cursor returns the same items, minus those handled since. An item shows ${INBOX_HOLD_BACK_MS / 1000} seconds after it happens, and leaves the inbox once what it is about is handled (the request answered, the reservation returned); the same \`id\` with a later \`occurredAt\` means it came back. \`POST /inbox/acknowledge\` hides an item for the whole store. When Louez cannot read some item types, the others still come and \`unavailable\` names the missing ones; their items come with a later call at \`nextCursor\`, late but not lost, while the other types are not given again. Up to \`limit\` items a call (${INBOX_PAGE_DEFAULT} by default, ${INBOX_PAGE_MAX} at most). A cursor this operation did not return answers \`INVALID_CURSOR\`. Each type of item shows only to a key that can read what it shows: payments for payment items, customers for the customer's name.`,
    ].join("\n"),
  })
  .input(listInboxInput)
  .output(listInboxOutput)
  .handler(async ({ context, input }) => listInbox(await readerOf(context), input));

const acknowledge = storeProcedure
  .meta({
    capability: "inbox.acknowledge",
    // Any domain's write opens it; the handler acknowledges only what the caller may (`acknowledgesType`).
    scope: { domain: "reservations", level: "write", anyOf: ANY_OTHER_DOMAIN },
    mcp: {
      name: "inbox_acknowledge",
      title: "Mark Inbox Items Handled",
      description: `Mark inbox items as handled, for the whole store: they leave inbox_list for every member and agent. Takes each item's id and occurredAt as inbox_list returned them, up to ${INBOX_ACKNOWLEDGE_MAX} at once. An item that comes back later (the same id, a later occurredAt) shows again. Items not in the inbox now with that occurredAt are left unmarked and come back in rejected: with currentOccurredAt when the inbox holds the item with another occurrence (the one to send when the user means it), null when it left the inbox (handled already). After a rejection, inbox_list without a cursor gives what the inbox holds now. Marking an item twice changes nothing. A mark is kept ${INBOX_ACKNOWLEDGEMENT_RETENTION_DAYS} days: an item still open after that shows again. It is for what the user dealt with: an item whose record is handled leaves the inbox by itself. Needs write access to the item's first domain.`,
      bundle: "daily",
      effect: "overwrite",
      annotations: { idempotentHint: true },
    },
  })
  .route({
    method: "POST",
    path: "/inbox/acknowledge",
    description: `Marks inbox items as handled for the whole store: they leave \`GET /inbox\` for every member and every key. Takes each item's \`id\` and \`occurredAt\` as \`GET /inbox\` returned them, up to ${INBOX_ACKNOWLEDGE_MAX} at once. Items the inbox does not hold now with that \`occurredAt\` are left unmarked and come back in \`rejected\`: with \`currentOccurredAt\` when the inbox holds the item with another occurrence (send it again with that one to mark it), null when it left the inbox. After a rejection, \`GET /inbox\` without a cursor gives what the inbox holds now. Marking an item twice changes nothing; it counts in \`alreadyAcknowledged\`. An item that comes back later (the same \`id\`, a later \`occurredAt\`) shows again, and so does one still open ${INBOX_ACKNOWLEDGEMENT_RETENTION_DAYS} days after its mark. An item whose record is handled leaves the inbox by itself. Needs a key that can change what the item is about (payments for a failed payment, reservations for a booking request), else \`PERMISSION_DENIED\`; an \`id\` that is not an inbox item's answers \`INBOX_ITEM_INVALID\`.`,
  })
  .input(acknowledgeInboxInput)
  .output(acknowledgeInboxOutput)
  .handler(async ({ context, input }) => {
    const { actor } = context;
    const reader = await readerOf(context);
    const mayWrite = (domain: ApiDomain) =>
      allows(actor.role, actor.credential.scopes, { domain, level: "write" });
    return acknowledgeInbox(
      reader,
      {
        storeId: actor.storeId,
        userId: actor.credential.userId,
        credentialId: actor.credential.id,
        clientName: actor.credential.clientName,
        may: (type: InboxItemType) => acknowledgesType(type, reader.reads, mayWrite),
        // A handoff is acknowledged under its kind's domain, an approval under its procedure's.
        refusedFor: (item) => {
          const domain =
            item.type === "handoff_waiting"
              ? HANDOFF_KIND_DOMAINS[item.details.kind as StepKind]
              : item.type === "approval_waiting"
                ? (item.details.domain as ApiDomain)
                : null;
          return domain && !mayWrite(domain) ? domain : null;
        },
      },
      input,
    );
  });

export const dashboardInboxRouter = { list, acknowledge };
