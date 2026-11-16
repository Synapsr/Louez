import {
  createReservationInput,
  createReservationOutput,
} from "../../contracts/reservation-create";
import { approvalAsked, restApprovalAsked } from "../../platform/approval-help";
import type { Consequence, Consequences } from "../../platform/approval-rule";
import { CONFIRMATION_HEADER } from "../../platform/confirmation";
import { platformErrors } from "../../platform/errors";
import { customerLinks, reservationLinks } from "../../platform/links";
import { allows, type ProcedureScope } from "../../platform/permissions";
import { storeProcedure } from "../../platform/procedures";
import { readAfterCommit } from "../../platform/errors";
import {
  createStoreReservation,
  recoverCreatedReservation,
  type CreatedReservation,
  type ReservationCreateCaller,
  type ReservationCreatePreview,
} from "../../services/reservation-create";
import { getReservation } from "../../services/reservations";
import { confirmUnderLock, mayRead, type ProductContext } from "./product-context";

/**
 * The store's creation of a reservation, on every transport
 * (`reservations.create`): the contract, the rights and the confirmation.
 * The logic is in services/reservation-create.ts.
 */

const RESERVATIONS_WRITE: ProcedureScope = { domain: "reservations", level: "write" };

/**
 * A creation names a customer, or adds one: the caller may read the store's
 * customers, and write them for the e-mail form (which may add one). Checked
 * before anything is read, whatever the store holds, so the answer never
 * tells a caller without that right whether an e-mail is a customer's.
 */
function requireCustomerRights(context: ProductContext, addsByEmail: boolean) {
  if (!mayRead(context, "customers")) throw platformErrors.permissionDenied("customers:read");
  if (
    addsByEmail &&
    !allows(context.actor.role, context.actor.credential.scopes, {
      domain: "customers",
      level: "write",
    })
  ) {
    throw platformErrors.permissionDenied("customers:write");
  }
}

/**
 * What the creation the preview shows does: a change the store can put back
 * (it cancels the booking), always; a message to the customer when one goes;
 * a stock override when either flag is sent, even with nothing short
 * (decision D2 and slice 5, docs/domain/reservation-changes.md).
 */
function createConsequences(preview: ReservationCreatePreview): Consequences {
  const consequences: [Consequence, ...Consequence[]] = ["change"];
  if (preview.message.sends) consequences.push("customer_message");
  if (preview.overbooking !== null || preview.turnoverBuffer !== null) {
    consequences.push("stock_override");
  }
  return consequences;
}

/**
 * The confirmation of a creation, bound to what its preview shows (the
 * customer, the dates, each line's price, the totals, the shortfalls booked
 * over or passed past the buffer, and the message), to where the message
 * goes, and to the stock the booking asks for. A competing booking that
 * changes the shortfalls, a price or a setting that changes since, voids the
 * token or the approval.
 */
const createConfirmation = (context: ProductContext, path: readonly string[], input: unknown) =>
  confirmUnderLock(
    context,
    path,
    input,
    (preview: ReservationCreatePreview) => {
      const { summary: _summary, recipientsHash, demand, ...details } = preview;
      // The recipients and the stock demand are bound, and never shown.
      return {
        state: { ...details, recipientsHash, demand },
        details,
        consequences: createConsequences(preview),
      };
    },
    RESERVATIONS_WRITE,
  );

const caller = (context: ProductContext): ReservationCreateCaller => ({
  storeId: context.actor.storeId,
  userId: context.actor.credential.userId,
  credential: { kind: context.actor.credential.kind, id: context.actor.credential.id },
  transport: context.actor.transport,
  store: {
    id: context.store.id,
    name: context.store.name,
    slug: context.store.slug,
    ownerUserId: context.store.userId,
  },
  ports: context.ports,
});

/** What a creation answers: its reservation as `reservations.get` reads it now, with what it decided. */
async function answerOf(
  context: Pick<ProductContext, "actor" | "store" | "ports">,
  created: CreatedReservation,
) {
  const { urls } = context.ports;
  const reservation = await readAfterCommit(() =>
    getReservation(
      {
        storeId: context.actor.storeId,
        currency: context.store.settings?.currency ?? "EUR",
        customers: true,
        payments: mayRead(context, "payments"),
      },
      created.id,
    ),
  );
  const links = reservationLinks(urls, context.store, reservation);
  return {
    id: created.id,
    reservation: {
      ...reservation,
      links,
      customer: reservation.customer && {
        ...reservation.customer,
        links: customerLinks(urls, context.store, reservation.customer),
      },
    },
    customer: created.customer,
    capacity: created.capacity,
    message: created.message,
    warnings: created.warnings,
    links,
  };
}

const REFUSED =
  "Custom lines, prices or deposits typed by hand, discounts and promo codes, delivery, insurance and a pending status are the dashboard's: each answers RESERVATION_OPTION_NOT_AVAILABLE with details.option.";

const create = storeProcedure
  .meta({
    capability: "reservations.create",
    scope: RESERVATIONS_WRITE,
    sensitive: "send",
    personApproval: true,
    requiresIdempotencyKey: true,
    // Its answer lost after the commit: the reservation it recorded, as it is now.
    recoverUnknown: async (targetId, context) =>
      answerOf(context, await recoverCreatedReservation(context.actor.storeId, targetId)),
    mcp: {
      name: "reservations_create",
      title: "Create Reservation",
      description: `Create a reservation of catalog products, picked up at the store, as a quote (the customer accepts it; it takes no stock) or confirmed (its items leave the stock). The customer is { id } or { email, firstName, lastName, phone? }: a customer the store has with that e-mail is used as is, never changed (customer.created: false), else one is added. Each line is priced as the online store's checkout prices it (catalog, promotion, seasonal prices, taxes), in the store's currency; no price is sent. The store's booking rules (opening hours, notice, durations) come back as warnings, never a refusal. notifyCustomer is required: true sends the quote or the confirmation e-mail, when the store sends it; the preview and the answer say whether one goes. It requires idempotencyKey: the same key answers the first call's result and creates nothing more. A product that is not active, a missing required accessory (details.missing names each, to add as lines), or a consumable out of stock is refused. A booking the stock cannot cover answers RESERVATION_INSUFFICIENT_CAPACITY with each short line (details.shortfalls); lines short only with the turnover buffer answer RESERVATION_TURNOVER_BUFFER_CONFLICT. The same input with allowOverbooking: true, or overrideTurnoverBuffer: true, creates it all the same: each passes only its own refusal, and sending either, even when nothing is short, is the user's to approve. ${approvalAsked("a preview of the customer, the dates, each line's price, the totals and the lines short")} Without a flag, the first call answers CONFIRMATION_REQUIRED with that preview, on a connection that asks for confirmations. ${REFUSED} Returns the reservation as reservations_get does, customer { id, created }, capacity, message, warnings and \`links\`, its dashboard page to give the user.`,
      bundle: "daily",
      effect: "additive",
      reach: "customer",
    },
  })
  .route({
    method: "POST",
    path: "/reservations",
    description: [
      "Creates a reservation of catalog products, picked up at the store's main location, as a `quote` (the customer accepts it; it takes no stock) or `confirmed` (its items leave the stock for these dates).",
      "",
      "- `customer` is `{ id }`, a customer of the store, or `{ email, firstName, lastName, phone? }`: a customer the store has with that e-mail is used as is and never changed (`customer.created: false`), else one is added. The key must read customers, and write them for the e-mail form.",
      "- Each line is priced as the online store's checkout prices the same cart: the catalog, the product's promotion, seasonal prices and the store's taxes, in the store's currency. No price is sent.",
      "- The store's booking rules (opening hours, notice, durations) come back in `warnings`, never as a refusal.",
      "- `notifyCustomer` is required: `true` queues the quote e-mail or the booking confirmation when the store sends that e-mail; the preview and `message` say whether one goes.",
      "- It requires an `Idempotency-Key`: the same key returns the first call's result and creates nothing more.",
      "",
      "A product that is not active, a missing required accessory (`details.missing`), or a consumable out of stock is refused. A booking the stock cannot cover answers `RESERVATION_INSUFFICIENT_CAPACITY` with `details.shortfalls`; lines short only with the turnover buffer answer `RESERVATION_TURNOVER_BUFFER_CONFLICT`. `allowOverbooking: true` and `overrideTurnoverBuffer: true` each pass only their own refusal.",
      "",
      `On a key set to ask for confirmations (the default), a creation without either flag first answers 412 \`CONFIRMATION_REQUIRED\` with its preview. Sending either flag, even when nothing is short, is the key's owner's to approve. ${restApprovalAsked("the preview")}`,
      "",
      REFUSED.replace(
        /RESERVATION_OPTION_NOT_AVAILABLE/,
        "`RESERVATION_OPTION_NOT_AVAILABLE`",
      ).replace("details.option", "`details.option`"),
      "",
      "Returns the reservation as `GET /reservations/{id}` does, `customer: { id, created }`, `capacity`, `message`, `warnings` and `links.dashboard`.",
    ].join("\n"),
  })
  .input(createReservationInput)
  .output(createReservationOutput)
  .handler(async ({ context, input, path }) => {
    requireCustomerRights(context, "email" in input.customer);
    const created = await createStoreReservation(caller(context), input, {
      confirm: createConfirmation(context, path, input),
      // A call that went on with a token or an approval id was bound to its
      // preview: an approval when a flag was sent (a person always approves
      // an override), else a token. Without one, nobody was asked.
      asked: (preview) =>
        !context.headers.get(CONFIRMATION_HEADER)
          ? "none"
          : preview.overbooking !== null || preview.turnoverBuffer !== null
            ? "approval"
            : "token",
    });
    return answerOf(context, created);
  });

export { create };
