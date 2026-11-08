import {
  listStoresInput,
  listStoresOutput,
  storeErrors,
  STORE_PAGE_MAX,
} from "../../contracts/stores";
import { connectionStores } from "../../platform/actor";
import { storeLinks } from "../../platform/links";
import { accountProcedure, missingTransport } from "../../platform/procedures";

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
        "List the stores this connection may act on, with your role in each and its `links`: the store's dashboard and, once it is online, its storefront. Give the user those URLs when they ask where to see their store. When the connection covers several stores, pass the store's id as storeId to the other tools.",
      bundle: "daily",
      annotations: { readOnlyHint: true, idempotentHint: true },
    },
  })
  .route({ method: "GET", path: "/stores" })
  .input(listStoresInput)
  .output(listStoresOutput)
  .handler(async ({ context, input }) => {
    const { ports } = context;
    if (!ports) throw missingTransport();
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
    const items = page.map((store) => ({
      id: store.id,
      name: store.name,
      slug: store.slug,
      role: store.role === "owner" ? ("owner" as const) : ("member" as const),
      links: storeLinks(ports.urls, store),
    }));
    const last = page[page.length - 1];
    return { items, nextCursor: start + limit < all.length && last ? last.id : null };
  });

export const dashboardStoresRouter = { list };
