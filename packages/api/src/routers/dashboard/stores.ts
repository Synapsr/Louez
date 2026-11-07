import {
  listStoresInput,
  listStoresOutput,
  storeErrors,
  STORE_PAGE_MAX,
} from "../../contracts/stores";
import { connectionStores } from "../../platform/actor";
import { accountProcedure } from "../../platform/procedures";

/**
 * The stores the connection may act on, with the user's role in each: every
 * membership for a session, an API key's store, a grant's stores. An agent
 * whose connection covers several stores calls it first, then passes the
 * store's id as `storeId`.
 */
const list = accountProcedure
  .meta({
    capability: "stores.list",
    account: true,
    mcp: {
      name: "stores_list",
      description:
        "List the stores this connection may act on, with your role in each. When it covers several stores, pass the store's id as storeId to the other tools.",
      bundle: "daily",
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
  })
  .route({ method: "GET", path: "/stores" })
  .input(listStoresInput)
  .output(listStoresOutput)
  .handler(async ({ context, input }) => {
    // Ordered by name, then id; a connection reaches few stores, so the page
    // is cut from the whole list.
    const all = await connectionStores(context.actor);
    const limit = input.limit ?? STORE_PAGE_MAX;
    let start = 0;
    if (input.cursor) {
      const index = all.findIndex((store) => store.id === input.cursor);
      if (index === -1) throw storeErrors.invalidCursor();
      start = index + 1;
    }
    const page = all.slice(start, start + limit);
    const items = page.map(({ id, name, slug, role }) => ({
      id,
      name,
      slug,
      role: role === "owner" ? ("owner" as const) : ("member" as const),
    }));
    const last = page[page.length - 1];
    return { items, nextCursor: start + limit < all.length && last ? last.id : null };
  });

export const dashboardStoresRouter = { list };
