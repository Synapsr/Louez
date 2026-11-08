import { z } from "zod";

import { apiError } from "../platform/errors";
import { resourceLinksSchema } from "./links";

/** The stores contract: the stores a connection may act on. No database here. */

/** Largest page `stores.list` returns, and its default. */
export const STORE_PAGE_MAX = 100;

export const listStoresInput = z.object({
  cursor: z
    .string()
    .max(64)
    .optional()
    .describe("The nextCursor of the previous page. Leave it out for the first page."),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(STORE_PAGE_MAX)
    .optional()
    .describe(`Stores per page, ${STORE_PAGE_MAX} at most and by default.`),
});

export const storeSummarySchema = z.object({
  /** Pass it as `storeId` to a tool, or in the Louez-Store header. */
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  /** The user's role in the store; what the connection may do there is this role cut down to its rights. */
  role: z.enum(["owner", "member"]),
  /** The store's dashboard, and its storefront once the store is online. */
  links: resourceLinksSchema,
});

export const listStoresOutput = z.object({
  items: z.array(storeSummarySchema),
  /** Null on the last page. */
  nextCursor: z.string().nullable(),
});

export const storeErrors = {
  invalidCursor: () =>
    apiError("BAD_REQUEST", "INVALID_CURSOR", {
      message: "This cursor is not one stores_list returned. Start again without a cursor.",
      i18nKey: "errors.invalidData",
    }),
} as const;
