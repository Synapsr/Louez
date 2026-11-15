/**
 * Test preload (`node --import`): no test reaches a host other than
 * 127.0.0.1. A fetch elsewhere throws, and fails the run even when the code
 * under test catches the error (as the CLI does, as a network failure).
 */
const realFetch = globalThis.fetch;

globalThis.fetch = (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.hostname !== "127.0.0.1") {
    process.exitCode = 1;
    process.stderr.write(`network-guard: a test fetched ${url.origin}; tests stay on 127.0.0.1.\n`);
    return Promise.reject(new Error(`network-guard: ${url.origin} is not 127.0.0.1`));
  }
  return realFetch(input, init);
};
