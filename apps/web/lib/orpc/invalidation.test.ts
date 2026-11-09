import assert from "node:assert/strict";
import { test } from "node:test";

import { QueryClient } from "@tanstack/react-query";

import { orpc } from "@/lib/orpc/react";
import { productsQueries } from "@/lib/queries/products.queries";

import { invalidateProductInventory, invalidateVariantCatalog } from "./invalidation";

const seed = (client: QueryClient, keys: ReadonlyArray<readonly unknown[]>) => {
  for (const key of keys) client.setQueryData(key, { seeded: true });
};
const invalidated = (client: QueryClient, key: readonly unknown[]) =>
  client.getQueryState(key)?.isInvalidated ?? false;

test("a unit or downtime change marks the unit history, the timeline and the lists stale", async () => {
  const client = new QueryClient();
  const history = productsQueries.unitHistory("unit_1").queryKey;
  const timeline = productsQueries.reservationTimeline({
    id: "product_1",
    from: new Date("2030-01-01T00:00:00Z"),
    to: new Date("2030-02-01T00:00:00Z"),
  }).queryKey;
  const list = productsQueries.list().queryKey;
  const categories = orpc.dashboard.categories.list.queryOptions({ input: {} }).queryKey;
  seed(client, [history, timeline, list, categories]);

  await invalidateProductInventory(client);

  assert.equal(invalidated(client, history), true);
  assert.equal(invalidated(client, timeline), true);
  assert.equal(invalidated(client, list), true);
  assert.equal(invalidated(client, categories), false, "other domains stay fresh");
});

test("a catalog change marks the variants and their usage stale, not the unit history", async () => {
  const client = new QueryClient();
  const variants = productsQueries.variantsKey();
  const usage = productsQueries.variantUsage().queryKey;
  const history = productsQueries.unitHistory("unit_1").queryKey;
  seed(client, [variants, usage, history]);

  await invalidateVariantCatalog(client);

  assert.equal(invalidated(client, variants), true);
  assert.equal(invalidated(client, usage), true);
  assert.equal(invalidated(client, history), false);
});
