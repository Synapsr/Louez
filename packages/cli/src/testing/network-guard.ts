/**
 * Test preload (`node --import`): no test reaches a host other than
 * 127.0.0.1, on the first request or on any redirect after it. A fetch
 * elsewhere throws, and fails the run even when the code under test catches
 * the error (as the CLI does, as a network failure).
 *
 * Every request goes out with `redirect: "manual"`; when the caller asked
 * fetch to follow redirects (its default), the guard follows them itself,
 * checking each hop before it is requested. A caller that asked for
 * "manual" or "error" gets that behaviour unchanged.
 */
const realFetch = globalThis.fetch;
const MAX_HOPS = 20;

function refuse(url: URL): Promise<never> {
  process.exitCode = 1;
  process.stderr.write(`network-guard: a test fetched ${url.origin}; tests stay on 127.0.0.1.\n`);
  return Promise.reject(new Error(`network-guard: ${url.origin} is not 127.0.0.1`));
}

globalThis.fetch = async (input, init) => {
  let url = new URL(input instanceof Request ? input.url : String(input));
  const follow = (init?.redirect ?? "follow") === "follow";
  let request: RequestInit = { ...init, redirect: follow ? "manual" : init?.redirect };
  for (let hop = 0; ; hop++) {
    if (url.hostname !== "127.0.0.1") return refuse(url);
    const response = await realFetch(url, request);
    const location = response.headers.get("location");
    if (!follow || response.status < 300 || response.status >= 400 || !location) return response;
    if (hop === MAX_HOPS) throw new TypeError("network-guard: too many redirects");
    url = new URL(location, url);
    // As fetch does: a 303, or a 301 or 302 after a POST, goes on as a GET without a body.
    if (
      response.status === 303 ||
      ((response.status === 301 || response.status === 302) && request.method === "POST")
    ) {
      request = { ...request, method: "GET", body: undefined };
    }
  }
};
