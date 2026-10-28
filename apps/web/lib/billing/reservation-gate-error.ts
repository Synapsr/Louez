import { STORE_NOT_ACCEPTING_RESERVATIONS_ERROR } from "@louez/types";

/**
 * Whether a failed mutation was refused by the card gate (README §8.4): its message is
 * the shared error key. No server import, so client components can call it.
 */
export function isReservationGateRefusal(error: unknown): boolean {
  return error instanceof Error && error.message === STORE_NOT_ACCEPTING_RESERVATIONS_ERROR;
}

/**
 * The params of STORE_NOT_ACCEPTING_RESERVATIONS_ERROR for a renter: the store's public
 * phone and email, which the message shows (design §4.7). Never a billing reason.
 */
export function renterGateRefusalParams(store: {
  readonly phone: string | null;
  readonly email: string | null;
}): { hasContact: "yes" | "no"; contact: string } {
  const contact = [store.phone, store.email]
    .flatMap((value) => (value?.trim() ? [value.trim()] : []))
    .join(" · ");
  return { hasContact: contact ? "yes" : "no", contact };
}
