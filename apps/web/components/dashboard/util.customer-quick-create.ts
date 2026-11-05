import type { CustomerFormBuiltInKey } from "@louez/types";
import type { CustomerFormLayoutItem } from "@louez/validations";

/** Who the customer is and how to reach them: what the counter needs to book right away. */
const QUICK_CREATE_KEYS: ReadonlySet<CustomerFormBuiltInKey> = new Set([
  "firstName",
  "lastName",
  "email",
  "phone",
  "companyName",
]);

/**
 * The fields of the quick-create dialog, in the store's order and widths: the
 * identity and contact fields, plus anything the store made required so the
 * customer can still be saved. The rest is completed later on the record.
 */
export const selectQuickCreateItems = <TItem extends CustomerFormLayoutItem<unknown>>(
  items: readonly TItem[],
): TItem[] =>
  items.filter(
    (item) => item.required || (item.kind === "builtin" && QUICK_CREATE_KEYS.has(item.key)),
  );
