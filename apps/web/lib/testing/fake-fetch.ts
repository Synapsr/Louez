/**
 * The network of a rendered test that goes through the app's own oRPC client:
 * every `fetch` reaches the handler the test sets, which answers when it
 * chooses. Import it before any module that builds the client, which keeps the
 * `fetch` it finds when it is built.
 */
export type FetchHandler = (request: Request) => Promise<Response>;

let handler: FetchHandler = (request) =>
  Promise.reject(new Error(`No fetch handler set for ${request.url}`));

export const setFetchHandler = (next: FetchHandler) => {
  handler = next;
};

globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) =>
  handler(new Request(input, init))) as typeof fetch;

/** An oRPC answer, as the server's RPC handler sends it. */
export const rpcAnswer = (data: unknown) =>
  new Response(JSON.stringify({ json: data }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
