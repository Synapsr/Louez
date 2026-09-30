import type { CustomerCreatedVia } from "@louez/types";

import type { CustomerFormCustomer } from "../customer-form.types";

/** What the side column of the customer record shows and edits. */
export interface CustomerRecord extends CustomerFormCustomer {
  createdVia: CustomerCreatedVia | null;
}
