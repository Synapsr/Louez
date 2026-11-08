import { STORE_NOT_ACCEPTING_RESERVATIONS_ERROR } from "@louez/types";

/**
 * Whether a failed mutation was refused by the card gate (README §8.4): an agent-ready
 * procedure says so in its translation key (`data.i18nKey`), an older one in its message.
 * No server import, so client components can call it.
 */
export function isReservationGateRefusal(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const data: unknown = "data" in error ? error.data : undefined;
  const i18nKey = data && typeof data === "object" && "i18nKey" in data ? data.i18nKey : undefined;
  return (
    error.message === STORE_NOT_ACCEPTING_RESERVATIONS_ERROR ||
    i18nKey === STORE_NOT_ACCEPTING_RESERVATIONS_ERROR
  );
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
