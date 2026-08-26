import assert from "node:assert/strict";
import { test } from "node:test";

const restoreGlobal = (key: "document" | "fetch" | "window", value?: PropertyDescriptor): void => {
  if (value) {
    Object.defineProperty(globalThis, key, value);
    return;
  }

  Reflect.deleteProperty(globalThis, key);
};

test("resolves auth requests against the runtime browser origin", async () => {
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  const originalFetch = Object.getOwnPropertyDescriptor(globalThis, "fetch");
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const requests: string[] = [];

  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      addEventListener() {},
      location: { origin: "https://runtime-auth.example.invalid" },
      removeEventListener() {},
    },
  });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      addEventListener() {},
      removeEventListener() {},
      visibilityState: "visible",
    },
  });
  Object.defineProperty(globalThis, "fetch", {
    configurable: true,
    value: async (input: string | URL | Request): Promise<Response> => {
      requests.push(input instanceof Request ? input.url : String(input));
      return new Response(JSON.stringify({ success: true }), {
        headers: { "content-type": "application/json" },
        status: 200,
      });
    },
  });

  try {
    const { authClient } = await import("./client");

    await authClient.signOut();

    assert.deepEqual(requests, ["https://runtime-auth.example.invalid/api/auth/sign-out"]);
  } finally {
    restoreGlobal("document", originalDocument);
    restoreGlobal("fetch", originalFetch);
    restoreGlobal("window", originalWindow);
  }
});
