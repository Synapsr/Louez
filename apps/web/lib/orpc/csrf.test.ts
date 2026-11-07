import assert from "node:assert/strict";
import { test } from "node:test";

import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import { os } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { z } from "zod";

import { rpcCsrfHandlerPlugin, rpcCsrfLinkPlugin } from "./csrf";

// The CSRF boundary of /api/rpc: the handler as the route builds it, the link
// as the app's client builds it.

let writes = 0;
const router = {
  write: os.input(z.object({ value: z.string() }).optional()).handler(() => {
    writes += 1;
    return { ok: true };
  }),
};
const handler = new RPCHandler(router, { plugins: [rpcCsrfHandlerPlugin()] });

const serve = async (request: Request) => {
  const { response } = await handler.handle(request, { prefix: "/api/rpc", context: {} });
  return response ?? new Response(null, { status: 404 });
};

test("a call without the app's header is refused, whatever its form", async () => {
  writes = 0;
  // What a foreign page can send with the user's cookie: a form, a plain fetch.
  const form = new FormData();
  form.set("data", JSON.stringify({ json: { value: "x" } }));
  const fromForm = await serve(
    new Request("https://app.louez.test/api/rpc/write", {
      method: "POST",
      headers: { origin: "https://evil.louez.test", cookie: "session=1" },
      body: form,
    }),
  );
  assert.equal(fromForm.status, 403);
  assert.match(await fromForm.text(), /CSRF_TOKEN_MISMATCH/);

  const fromFetch = await serve(
    new Request("https://app.louez.test/api/rpc/write", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: "session=1" },
      body: JSON.stringify({ json: { value: "x" } }),
    }),
  );
  assert.equal(fromFetch.status, 403);
  assert.equal(writes, 0);
});

test("the app's link sends the header, and its calls go through", async () => {
  writes = 0;
  const client = createORPCClient<{
    write: (input: { value: string }) => Promise<{ ok: boolean }>;
  }>(
    new RPCLink({
      url: "https://app.louez.test/api/rpc",
      plugins: [rpcCsrfLinkPlugin()],
      fetch: (request) => serve(request as Request),
    }),
  );
  assert.deepEqual(await client.write({ value: "x" }), { ok: true });
  assert.equal(writes, 1);
});
