import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NextIntlClientProvider } from "next-intl";

import type { NeedsALookItem } from "@/lib/inbox/needs-a-look";
import { needsALookQueries } from "@/lib/queries/needs-a-look.queries";

import { NeedsALookAlert } from "./needs-a-look-alert";

// The home's line reads the inbox after paint: while it loads, or when the read
// fails, the home renders without it, and no error reaches the page.

const messages = JSON.parse(
  readFileSync(new URL("../../../messages/en.json", import.meta.url), "utf8"),
);

const render = (client: QueryClient) =>
  renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <NextIntlClientProvider locale="en" messages={messages} timeZone="Europe/Paris">
        <main>
          <NeedsALookAlert />
        </main>
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );

const items = (count: number) =>
  Array.from({ length: count }, (_, index) => ({ id: `refund_undone:${index}` }) as NeedsALookItem);

describe("the home's line", () => {
  test("while the inbox has not answered, the home renders without it", () => {
    assert.equal(render(new QueryClient()), "<main></main>");
  });

  test("a read that failed shows no line and surfaces no error", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await client.prefetchQuery({
      ...needsALookQueries.summary(),
      queryFn: () => Promise.reject(new Error("the inbox is down")),
    });
    assert.equal(client.getQueryState(needsALookQueries.summaryKey())?.status, "error");
    assert.equal(render(client), "<main></main>");
  });

  test("what waits shows as a count, 99+ past the page; nothing waiting, no line", () => {
    const client = new QueryClient();
    client.setQueryData(needsALookQueries.summaryKey(), {
      items: items(3),
      more: false,
      incomplete: false,
    });
    assert.match(render(client), /3 things to check/);
    client.setQueryData(needsALookQueries.summaryKey(), {
      items: items(100),
      more: true,
      incomplete: false,
    });
    assert.match(render(client), /99\+ things to check/);
    client.setQueryData(needsALookQueries.summaryKey(), {
      items: [],
      more: false,
      incomplete: false,
    });
    assert.equal(render(client), "<main></main>");
  });
});
