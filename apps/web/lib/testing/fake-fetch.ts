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

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

/** An oRPC call a test answers: with the procedure's output, or a failure. */
export interface RpcCall {
  /** The procedure's name, the last segment of its path (`autocomplete`, `details`, `distance`). */
  endpoint: string;
  signal: AbortSignal;
  answer: Deferred<unknown>;
}

/**
 * The oRPC calls of a test, each waiting for the test to answer it, or to
 * fail it; a call its caller aborts rejects, as in a browser. `answers` names
 * the procedures answered at once, with that output.
 */
export const controlledRpc = (answers: Record<string, unknown> = {}) => {
  const calls: RpcCall[] = [];
  setFetchHandler((request) => {
    const endpoint = new URL(request.url).pathname.split("/").at(-1) ?? "";
    let resolve: (value: unknown) => void = () => {};
    let reject: (error: unknown) => void = () => {};
    const promise = new Promise<unknown>((onResolve, onReject) => {
      resolve = onResolve;
      reject = onReject;
    });
    calls.push({ endpoint, signal: request.signal, answer: { promise, resolve, reject } });
    if (endpoint in answers) resolve(answers[endpoint]);
    return new Promise<Response>((onAnswer, onFailure) => {
      request.signal.addEventListener("abort", () => onFailure(request.signal.reason));
      promise.then((output) => onAnswer(rpcAnswer(output)), onFailure);
    });
  });
  return calls;
};
