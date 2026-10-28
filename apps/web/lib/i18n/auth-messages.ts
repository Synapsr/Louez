import type { AbstractIntlMessages } from "next-intl";

/**
 * The message namespaces the sign-in pages read. The auth layout sends only these to
 * the browser: the whole catalogue would put every dashboard string, Louez Cloud's
 * prices included, in the login HTML.
 */
export const AUTH_MESSAGE_NAMESPACES = ["auth", "common"] as const;

/**
 * The messages of the sign-in pages. Without platform billing the Louez Cloud perks
 * (`auth.perk1` to `perk3`, its offer) are left out too, since the page does not show
 * them (louez-billing docs/plans/design.md §7.2).
 */
export function selectAuthMessages(
  messages: AbstractIntlMessages,
  billingEnabled: boolean,
): AbstractIntlMessages {
  const selected: AbstractIntlMessages = {};
  for (const namespace of AUTH_MESSAGE_NAMESPACES) {
    const value = messages[namespace];
    if (value !== undefined) selected[namespace] = value;
  }
  const auth = selected.auth;
  if (!billingEnabled && typeof auth === "object") {
    const { perk1: _perk1, perk2: _perk2, perk3: _perk3, ...rest } = auth;
    selected.auth = rest;
  }
  return selected;
}
