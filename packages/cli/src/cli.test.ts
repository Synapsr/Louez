import assert from "node:assert/strict";
import { chmod, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { after, afterEach, describe, test } from "node:test";

import { APPROVAL_POLL_SECONDS, EXIT, main, rerunCommand } from "./cli.js";
import { configFile, writeConfig } from "./config.js";
import type { Manifest, Operation } from "./manifest.js";
import {
  apiErrorBody,
  removeTempDirs,
  sendJson,
  startFakeApi,
  tempDir,
  testIo,
  type FakeApi,
  type Handler,
  type TestIo,
} from "./testing/fake-api.js";

const KEY = "lz_test_Secret0Key1Secret2Ke";

let api: FakeApi | undefined;
afterEach(async () => {
  await api?.close();
  api = undefined;
});
after(removeTempDirs);

async function serve(handler: Handler): Promise<FakeApi> {
  api = await startFakeApi(handler);
  return api;
}

/** Runs `louez <argv>` against the fake API with the key in the environment. */
async function louez(
  argv: string[],
  options: Parameters<typeof testIo>[1] = {},
): Promise<TestIo & { code: number }> {
  const io = await testIo(argv, {
    ...options,
    env: { LOUEZ_API_KEY: KEY, ...(api ? { LOUEZ_API_URL: api.url } : {}), ...options.env },
  });
  const code = await main(io);
  // The key is never written anywhere.
  assert.ok(!io.out().includes(KEY) && !io.err().includes(KEY), "the key is never printed");
  return Object.assign(io, { code });
}

const payment = {
  reservationId: "r1",
  number: "R-1",
  type: "rental",
  amount: "10.00",
  method: "cash",
};

const approvalRequired = (url: string, pollAfterSeconds = 30, expiresAt = "2026-11-16T10:00:00Z") =>
  apiErrorBody(
    412,
    "APPROVAL_REQUIRED",
    "Recording this payment needs the approval of the key's owner.",
    {
      preview: { summary: "Record 10.00 EUR in cash on R-1." },
      approval: {
        id: "apr_1",
        url,
        status: "pending",
        expiresAt,
        pollAfterSeconds,
        decision: null,
      },
      confirmationToken: "apr_1",
    },
  );

const RECORD = [
  "payments",
  "record",
  "r1",
  "--type",
  "rental",
  "--amount",
  "10.00",
  "--method",
  "cash",
];

describe("a call", () => {
  test("prints the answer's JSON on stdout and exits 0: one line when piped, indented on a terminal", async () => {
    const server = await serve((request, response) =>
      sendJson(response, 200, { items: [{ id: "r1" }], nextCursor: null }),
    );
    const piped = await louez(["reservations", "list", "--status", "pending", "--limit", "5"]);
    assert.equal(piped.code, EXIT.ok);
    assert.equal(piped.out(), '{"items":[{"id":"r1"}],"nextCursor":null}\n');
    assert.equal(piped.err(), "");

    const request = server.received[0]!;
    assert.equal(request.method, "GET");
    assert.equal(request.url, "/api/v1/reservations?status=pending&limit=5");
    assert.equal(request.headers.authorization, `Bearer ${KEY}`);
    assert.equal(request.headers["idempotency-key"], undefined);

    const tty = await louez(["reservations", "list"], { tty: true });
    assert.equal(
      tty.out(),
      `${JSON.stringify({ items: [{ id: "r1" }], nextCursor: null }, null, 2)}\n`,
    );
  });

  test("sends a write's body, with an idempotency key of its own when none is given", async () => {
    const server = await serve((_, response) => sendJson(response, 200, payment));
    const run = await louez(RECORD);
    assert.equal(run.code, EXIT.ok);
    const request = server.received[0]!;
    assert.equal(request.method, "POST");
    assert.equal(request.url, "/api/v1/reservations/r1/payments");
    assert.deepEqual(JSON.parse(request.body), { type: "rental", amount: "10.00", method: "cash" });
    assert.equal(request.headers["content-type"], "application/json");
    assert.equal(request.headers["idempotency-key"], "generated-key-1");
    // The generated key is printed only when the network fails.
    assert.equal(run.err(), "");

    await louez([...RECORD, "--idempotency-key", "mine-1"]);
    assert.equal(server.received[1]!.headers["idempotency-key"], "mine-1");
  });

  test("reaches an operation by its operationId and by its method and path", async () => {
    const server = await serve((_, response) => sendJson(response, 200, payment));
    assert.equal(
      (
        await louez([
          "record_payment",
          "r1",
          "--json",
          '{"type":"rental","amount":"1","method":"cash"}',
        ])
      ).code,
      EXIT.ok,
    );
    assert.equal(server.received[0]!.url, "/api/v1/reservations/r1/payments");

    const generic = await louez([
      "api",
      "post",
      "/reservations/r2/payments",
      "--json",
      '{"amount":"2"}',
    ]);
    assert.equal(generic.code, EXIT.ok);
    assert.equal(server.received[1]!.method, "POST");
    assert.equal(server.received[1]!.url, "/api/v1/reservations/r2/payments");
    assert.equal(server.received[1]!.body, '{"amount":"2"}');
    assert.equal(server.received[1]!.headers["idempotency-key"], "generated-key-1");

    await louez(["api", "GET", "/reservations?status=pending"]);
    assert.equal(server.received[2]!.url, "/api/v1/reservations?status=pending");
    assert.equal(server.received[2]!.headers["idempotency-key"], undefined);
  });

  test("writes an API error's JSON and one line on stderr, nothing on stdout, and exits 1", async () => {
    const error = apiErrorBody(404, "PAYMENT_NOT_FOUND", "No payment with this id.");
    await serve((_, response) => sendJson(response, 404, error));
    const run = await louez(["payments", "delete", "p1"]);
    assert.equal(run.code, EXIT.api);
    assert.equal(run.out(), "");
    assert.equal(
      run.err(),
      `${JSON.stringify(error)}\nlouez: 404 PAYMENT_NOT_FOUND: No payment with this id.\n`,
    );
  });

  test("never sends a write twice by itself", async () => {
    const server = await serve((_, response) =>
      sendJson(
        response,
        409,
        apiErrorBody(409, "OPERATION_IN_PROGRESS", "Still running.", undefined, true),
      ),
    );
    const run = await louez(RECORD);
    assert.equal(run.code, EXIT.api);
    assert.match(run.err(), /\(retryable\)/);
    assert.equal(server.received.length, 1);
  });

  test("exits 4 on a network failure, with the generated idempotency key to repeat the write with", async () => {
    const closed = await startFakeApi(() => {});
    await closed.close();
    const env = { LOUEZ_API_URL: closed.url };
    const write = await louez(RECORD, { env });
    assert.equal(write.code, EXIT.network);
    assert.match(write.err(), /could not be reached/);
    assert.match(write.err(), /again with --idempotency-key generated-key-1/);

    const read = await louez(["reservations", "list"], { env });
    assert.equal(read.code, EXIT.network);
    assert.doesNotMatch(read.err(), /idempotency/);
  });

  test("does not follow a redirect, and exits 1", async () => {
    const elsewhere = await startFakeApi((_, response) => response.end("{}"));
    try {
      await serve((_, response) => {
        response.writeHead(307, { Location: `${elsewhere.url}/stores` });
        response.end();
      });
      const run = await louez(["stores", "list"]);
      assert.equal(run.code, EXIT.api);
      assert.match(run.err(), /never follows one/);
      assert.equal(elsewhere.received.length, 0);
    } finally {
      await elsewhere.close();
    }
  });
});

describe("a request that runs out of time", () => {
  test("exits 4, prints the write's idempotency key to repeat it with, and sends nothing again", async () => {
    let sent = 0;
    // A server that never answers: the request ends only when its signal aborts.
    const fetch: typeof globalThis.fetch = (_, init) => {
      sent++;
      return new Promise((_, reject) => {
        const signal = init?.signal;
        if (signal?.aborted) reject(signal.reason);
        signal?.addEventListener("abort", () => reject(signal.reason));
      });
    };
    const run = await louez(RECORD, {
      env: { LOUEZ_API_URL: "https://app.louez.test/api/v1" },
      fetch,
      timedOut: true,
    });
    assert.equal(run.code, EXIT.network);
    assert.match(run.err(), /did not answer within 120 s/);
    assert.match(run.err(), /again with --idempotency-key generated-key-1/);
    assert.equal(run.out(), "");
    assert.equal(sent, 1);
  });
});

describe("the saved key", () => {
  /** Saves KEY for `server` with `auth login`. */
  async function login(server: FakeApi): Promise<string> {
    const configDir = await tempDir();
    const run = await louez(["auth", "login"], {
      configDir,
      env: { LOUEZ_API_KEY: undefined, LOUEZ_API_URL: server.url },
      stdin: KEY,
    });
    assert.equal(run.code, EXIT.ok);
    return configDir;
  }

  test("goes only to the origin it was saved for: another URL is refused, naming both, and gets nothing", async () => {
    const saved = await serve((_, response) => sendJson(response, 200, { items: [] }));
    const configDir = await login(saved);
    const other = await startFakeApi((_, response) => sendJson(response, 200, { items: [] }));
    try {
      for (const [argv, env] of [
        [["stores", "list", "--api-url", other.url], { LOUEZ_API_KEY: undefined }],
        [["stores", "list"], { LOUEZ_API_KEY: undefined, LOUEZ_API_URL: other.url }],
      ] as const) {
        const run = await louez([...argv], { configDir, env });
        assert.equal(run.code, EXIT.usage);
        assert.match(
          run.err(),
          new RegExp(`belongs to ${saved.origin}; it is never sent to ${other.origin}`),
        );
      }
      assert.equal(other.received.length, 0);
      // Only login's check reached the server it was saved for.
      assert.equal(saved.received.length, 1);

      // With no URL given, the saved key goes to the URL it was saved with.
      const call = await louez(["stores", "list"], {
        configDir,
        env: { LOUEZ_API_KEY: undefined, LOUEZ_API_URL: undefined },
      });
      assert.equal(call.code, EXIT.ok);
      assert.equal(saved.received.length, 2);
    } finally {
      await other.close();
    }
  });

  test("an explicit key goes with the URL given with it, and the saved key never does", async () => {
    const saved = await serve((_, response) => sendJson(response, 200, { items: [] }));
    const configDir = await login(saved);
    const other = await startFakeApi((_, response) => sendJson(response, 200, { items: [] }));
    try {
      const run = await louez(["stores", "list"], {
        configDir,
        env: { LOUEZ_API_KEY: "lz_othr_OtherServerKey000000", LOUEZ_API_URL: other.url },
      });
      assert.equal(run.code, EXIT.ok);
      assert.deepEqual(
        other.received.map((request) => request.headers.authorization),
        ["Bearer lz_othr_OtherServerKey000000"],
      );
    } finally {
      await other.close();
    }
  });
});

describe("choosing the key", () => {
  const SAVED = "lz_save_SavedSavedSavedSaved";
  const STAGING = "lz_stag_StagingStagingStagin";
  const OTHER = "lz_othr_GivenGivenGivenGiven";

  /** A config directory holding SAVED, for https://app.louez.test. */
  async function savedDir(apiKey = SAVED): Promise<string> {
    const configDir = await tempDir();
    await writeConfig(configDir, { apiKey, apiUrl: "https://app.louez.test/api/v1" });
    return configDir;
  }

  /** A fetch that records each request's key, answering 200. */
  function recorder() {
    const keys: string[] = [];
    const fetch: typeof globalThis.fetch = async (_, init) => {
      keys.push(new Headers(init?.headers).get("authorization") ?? "");
      return Response.json({ items: [] });
    };
    return { keys, fetch };
  }

  test("an empty or malformed key or URL that is given stops the command: no fallback, nothing sent", async () => {
    const configDir = await savedDir();
    const cases: Array<[string[], Record<string, string | undefined>, RegExp]> = [
      [
        ["api", "POST", "/products", "--api-key="],
        { LOUEZ_API_KEY: STAGING },
        /--api-key is empty/,
      ],
      [
        ["stores", "list", "--api-key", "1"],
        { LOUEZ_API_KEY: STAGING },
        /--api-key is not a Louez API key/,
      ],
      [["stores", "list", "--api-key", "lz_short"], {}, /--api-key is not a Louez API key/],
      [["stores", "list"], { LOUEZ_API_KEY: "" }, /LOUEZ_API_KEY is empty/],
      [["stores", "list"], { LOUEZ_API_KEY: "0" }, /LOUEZ_API_KEY is not a Louez API key/],
      [
        ["stores", "list"],
        { LOUEZ_API_KEY: `${STAGING}x` },
        /LOUEZ_API_KEY is not a Louez API key/,
      ],
      [["stores", "list", "--api-url="], { LOUEZ_API_KEY: undefined }, /--api-url is empty/],
      [
        ["stores", "list"],
        { LOUEZ_API_KEY: undefined, LOUEZ_API_URL: "" },
        /LOUEZ_API_URL is empty/,
      ],
      [["stores", "list", "--api-url="], { LOUEZ_API_KEY: STAGING }, /--api-url is empty/],
    ];
    for (const [argv, env, message] of cases) {
      const { keys, fetch } = recorder();
      const run = await louez(argv, { configDir, env, fetch });
      assert.equal(run.code, EXIT.usage, `${argv.join(" ")} ${JSON.stringify(env)}`);
      assert.match(run.err(), message);
      assert.deepEqual(keys, [], `${argv.join(" ")}: nothing is sent`);
    }

    const malformedSaved = await savedDir("lz_x");
    const { keys, fetch } = recorder();
    const run = await louez(["stores", "list"], {
      configDir: malformedSaved,
      env: { LOUEZ_API_KEY: undefined },
      fetch,
    });
    assert.equal(run.code, EXIT.usage);
    assert.match(run.err(), /The key saved in .* is not a Louez API key/);
    assert.deepEqual(keys, []);
  });

  test("login with an empty --api-key stops: it neither reads standard input nor saves", async () => {
    const configDir = await tempDir();
    const { keys, fetch } = recorder();
    const run = await louez(["auth", "login", "--api-key="], { configDir, stdin: OTHER, fetch });
    assert.equal(run.code, EXIT.usage);
    assert.match(run.err(), /empty/);
    assert.deepEqual(keys, []);
    await assert.rejects(stat(configFile(configDir)));
  });

  test("takes --api-key, then LOUEZ_API_KEY, then the saved key", async () => {
    const configDir = await savedDir();
    const env = { LOUEZ_API_URL: "https://app.louez.test/api/v1" };
    const sent = async (argv: string[], extra: Record<string, string | undefined>) => {
      const { keys, fetch } = recorder();
      assert.equal(
        (await louez(argv, { configDir, env: { ...env, ...extra }, fetch })).code,
        EXIT.ok,
      );
      return keys;
    };
    assert.deepEqual(
      await sent(["stores", "list", "--api-key", OTHER], { LOUEZ_API_KEY: STAGING }),
      [`Bearer ${OTHER}`],
    );
    assert.deepEqual(await sent(["stores", "list"], { LOUEZ_API_KEY: STAGING }), [
      `Bearer ${STAGING}`,
    ]);
    assert.deepEqual(await sent(["stores", "list"], { LOUEZ_API_KEY: undefined }), [
      `Bearer ${SAVED}`,
    ]);
  });

  test("a malformed key is refused without repeating it, wherever it was given", async () => {
    const { keys, fetch } = recorder();
    const cases: Array<[string[], Record<string, string | undefined>, RegExp]> = [
      // The argument would otherwise be echoed as unexpected.
      [
        ["stores", "list", "lz_hello_bad", "--api-key", "lz_hello_bad"],
        {},
        /--api-key is not a Louez API key/,
      ],
      [["--version", "--api-key", "lz_hello_bad"], {}, /--api-key is not a Louez API key/],
      [
        ["stores", "list"],
        { LOUEZ_API_KEY: "lz_hello_bad" },
        /LOUEZ_API_KEY is not a Louez API key/,
      ],
    ];
    for (const [argv, env, message] of cases) {
      const run = await louez(argv, { env, fetch });
      assert.equal(run.code, EXIT.usage, argv.join(" "));
      assert.match(run.err(), message);
      assert.doesNotMatch(run.err() + run.out(), /hello/);
    }
    assert.deepEqual(keys, []);
  });

  test("a malformed LOUEZ_API_KEY under a valid --api-key is no secret: the answer stays whole", async () => {
    const answer = { id: "X2hlbGxv", other: "lz_hello", count: 1 };
    await serve((_, response) => sendJson(response, 200, answer));
    const run = await louez(["stores", "list", "--api-key", OTHER], {
      env: { LOUEZ_API_KEY: "lz_hello" },
    });
    assert.equal(run.code, EXIT.ok);
    assert.equal(run.out(), `${JSON.stringify(answer)}\n`);
  });
});

describe("credentials in what is written", () => {
  test("a key given where a value was expected is a missing value, and never echoed", async () => {
    let fetched = 0;
    const fetch: typeof globalThis.fetch = async () => {
      fetched++;
      return Response.json({});
    };
    const run = await louez(
      ["api", "POST", "/reservations", "--json", "--api-key", "lz_sec1_SecretSecretSecret12"],
      { fetch },
    );
    assert.equal(run.code, EXIT.usage);
    assert.match(run.err(), /--json needs a value/);
    assert.doesNotMatch(run.err() + run.out(), /lz_sec1_SecretSecretSecret12/);
    assert.equal(fetched, 0);
  });

  test("every key given or in use is replaced wherever it appears, an API's answer included", async () => {
    const echoed = await louez([
      "stores",
      "list",
      "lz_sec2_SecretSecretSecret34",
      "--api-key",
      "lz_sec2_SecretSecretSecret34",
    ]);
    assert.equal(echoed.code, EXIT.usage);
    assert.match(echoed.err(), /Unexpected argument at position 3\./);
    assert.doesNotMatch(echoed.err(), /lz_sec2_SecretSecretSecret34/);

    // A server that quotes the request's credential back, in its message and as JSON.
    await serve((request, response) =>
      sendJson(
        response,
        401,
        apiErrorBody(401, "UNAUTHENTICATED", `Not a key: ${request.headers.authorization}`, {
          sent: request.headers.authorization,
        }),
      ),
    );
    const quoted = await louez(["stores", "list"]);
    assert.equal(quoted.code, EXIT.api);
    assert.match(quoted.err(), /Not a key: Bearer \[redacted\]/);
    assert.match(quoted.err(), /"sent":"Bearer \[redacted\]"/);
  });
});

describe("encoded forms of the key", () => {
  const encodeAll = (text: string) =>
    [...text]
      .map((char) => `%${char.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`)
      .join("");
  const base64 = (text: string) => Buffer.from(text).toString("base64");
  const base64url = (text: string) => Buffer.from(text).toString("base64url");

  test("are redacted wherever an answer holds them, and its JSON stays valid", async () => {
    const forms = {
      raw: KEY,
      uriComponent: encodeURIComponent(KEY),
      nonAlphanumeric: KEY.replace(
        /[^A-Za-z0-9]/g,
        (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
      ),
      allEncoded: encodeAll(KEY),
      allEncodedLowercase: encodeAll(KEY).toLowerCase(),
      subset: [...KEY].map((char, i) => (i % 3 === 0 ? encodeAll(char) : char)).join(""),
      base64: base64(KEY),
      base64Unpadded: base64(KEY).replace(/=+$/, ""),
      base64url: base64url(KEY),
      bearerBase64: base64(`Bearer ${KEY}`),
      bearerBase64Unpadded: base64(`Bearer ${KEY}`).replace(/=+$/, ""),
      bearerBase64url: base64url(`Bearer ${KEY}`),
      inside: base64(`user:${KEY}`),
      insideAgain: base64url(`ab${KEY}cd`),
    };
    await serve((_, response) =>
      sendJson(
        response,
        401,
        apiErrorBody(401, "UNAUTHENTICATED", "Not a key.", { forms, [KEY]: 1, count: 1 }),
      ),
    );
    const run = await louez(["stores", "list"]);
    assert.equal(run.code, EXIT.api);
    const [first = ""] = run.err().split("\n");
    const echoed = JSON.parse(first) as { data: { details: { forms: Record<string, string> } } };
    for (const [name, value] of Object.entries(echoed.data.details.forms)) {
      assert.match(value, /\[redacted\]/, name);
      assert.ok(!value.includes(forms[name as keyof typeof forms]), `${name} is gone`);
    }
    // A key as an object's key is redacted too; numbers are left whole.
    assert.match(first, /"\[redacted\]":1,"count":1/);
    for (const value of Object.values(forms)) assert.ok(!run.err().includes(value));
  });
});

describe("Ctrl-C during the approved write", () => {
  /** An API that asks for an approval, says it is approved, then never answers the approved write. */
  async function stalledWrite(onWrite: (io: TestIo) => void) {
    const writes: string[] = [];
    const io = await testIo([...RECORD, "--wait"], {
      env: { LOUEZ_API_KEY: KEY, LOUEZ_API_URL: "https://app.louez.test/api/v1" },
      fetch: (input, init) => {
        const headers = new Headers(init?.headers);
        if (String(input).includes("/handoffs/")) {
          return Promise.resolve(
            Response.json({ id: "apr_1", status: "approved", failure: null, decision: null }),
          );
        }
        if (headers.get("louez-confirmation") !== "apr_1") {
          return Promise.resolve(
            Response.json(approvalRequired("https://app.louez.test/handoffs/apr_1"), {
              status: 412,
            }),
          );
        }
        writes.push(headers.get("idempotency-key") ?? "");
        onWrite(io);
        return new Promise((resolve, reject) => {
          const signal = init?.signal;
          signal?.addEventListener("abort", () => reject(signal.reason));
          // Answers only when the test says so.
          stalled.answer = () => resolve(Response.json(payment));
        });
      },
    });
    const stalled: { answer?: () => void } = {};
    return { io, writes, stalled };
  }

  test(
    "a first Ctrl-C says the write was sent and its result awaited; the result still comes",
    { timeout: 10_000 },
    async () => {
      const { io, writes, stalled } = await stalledWrite((io) =>
        queueMicrotask(() => {
          io.interrupt();
          queueMicrotask(() => stalled.answer?.());
        }),
      );
      const code = await main(io);
      assert.equal(code, EXIT.ok);
      assert.deepEqual(JSON.parse(io.out()), payment);
      assert.match(
        io.err(),
        /the approved write was sent; waiting for its result\. Ctrl-C again stops waiting/,
      );
      assert.equal(writes.length, 1);
    },
  );

  test(
    "a second Ctrl-C stops waiting: exit 4, an unknown outcome, the command to repeat with the same key",
    { timeout: 10_000 },
    async () => {
      const { io, writes } = await stalledWrite((io) =>
        queueMicrotask(() => {
          io.interrupt();
          io.interrupt();
        }),
      );
      const code = await main(io);
      assert.equal(code, EXIT.network);
      assert.equal(writes.length, 1);
      assert.match(io.err(), /Its outcome is unknown: Louez may have carried it out/);
      assert.match(
        io.err(),
        new RegExp(
          `\\n {2}louez payments record r1 --type rental --amount 10\\.00 --method cash --confirmation apr_1 --idempotency-key ${writes[0]}\\n`,
        ),
      );
      assert.equal(writes[0], "generated-key-1");
    },
  );
});

describe("Ctrl-C during a read in flight", () => {
  test(
    "cancels the read at once: exit 3, the approval stays open, nothing carried out",
    { timeout: 10_000 },
    async () => {
      let posts = 0;
      let readAborted = false;
      const io = await testIo([...RECORD, "--wait"], {
        env: { LOUEZ_API_KEY: KEY, LOUEZ_API_URL: "https://app.louez.test/api/v1" },
        fetch: (input, init) => {
          if (String(input).includes("/handoffs/")) {
            // A read that never answers: Ctrl-C arrives while it waits.
            io.interrupt();
            return new Promise((_, reject) => {
              const signal = init?.signal;
              const abort = () => {
                readAborted = true;
                reject(signal?.reason);
              };
              if (signal?.aborted) abort();
              signal?.addEventListener("abort", abort);
            });
          }
          posts++;
          return Promise.resolve(
            Response.json(approvalRequired("https://app.louez.test/handoffs/apr_1"), {
              status: 412,
            }),
          );
        },
      });
      const code = await main(io);
      assert.equal(code, EXIT.person);
      assert.ok(readAborted, "the read in flight was aborted");
      assert.match(io.err(), /stopped waiting\. Nothing was done, and the approval stays open/);
      assert.equal(posts, 1);
    },
  );
});

describe("a write that requires an idempotency key", () => {
  const create: Operation = {
    id: "reservations_create",
    group: "reservations",
    action: "create",
    method: "POST",
    path: "/reservations",
    summary: "Create Reservation",
    description: "Creates a reservation.",
    pathParams: [],
    query: [],
    body: { required: true, fields: [] },
    idempotent: true,
    idempotencyRequired: true,
    confirmation: false,
  };
  const manifest: Manifest = {
    apiVersion: "test",
    groups: [{ name: "reservations", title: "Reservations", description: "" }],
    operations: [create],
  };

  test("is sent the key louez generates, or the one given, and its help says so", async () => {
    const server = await serve((_, response) => sendJson(response, 200, { id: "res_1" }));
    assert.equal((await louez(["reservations", "create"], { manifest })).code, EXIT.ok);
    assert.equal(
      (await louez(["reservations", "create", "--idempotency-key", "mine"], { manifest })).code,
      EXIT.ok,
    );
    assert.deepEqual(
      server.received.map((request) => request.headers["idempotency-key"]),
      ["generated-key-1", "mine"],
    );
    const help = await louez(["reservations", "create", "--help"], { manifest });
    assert.match(
      help.out(),
      /--idempotency-key \(required by the API; louez generates one unless you give it\)/,
    );
  });
});

describe("a command printed to run again", () => {
  const OTHER = "lz_othr_GivenGivenGivenGiven";

  /** The command printed after "run:", and the line under it. */
  function printed(err: string): { command: string; note: string } {
    const match = /run:\n {2}(.+)\n(.+)\n/.exec(err);
    assert.ok(match, err);
    return { command: match[1] ?? "", note: match[2] ?? "" };
  }

  test("never names a key nor a variable that holds one, keeps --api-url, and says which key to use", async () => {
    const server = await serve((_, response) =>
      sendJson(response, 412, approvalRequired("https://app.louez.test/handoffs/apr_1")),
    );
    const configDir = await tempDir();
    await writeConfig(configDir, { apiKey: KEY, apiUrl: server.url });
    const sources: Array<[string[], Record<string, string | undefined>, RegExp]> = [
      [
        ["--api-key", OTHER, "--api-url", server.url],
        { LOUEZ_API_KEY: KEY, LOUEZ_API_URL: undefined },
        /the key you gave with --api-key/,
      ],
      [
        ["--api-url", server.url],
        { LOUEZ_API_KEY: KEY, LOUEZ_API_URL: undefined },
        /the key in the environment variable LOUEZ_API_KEY/,
      ],
      [
        [],
        { LOUEZ_API_KEY: undefined, LOUEZ_API_URL: undefined },
        /the key saved by `louez auth login`/,
      ],
    ];
    for (const [extra, env, source] of sources) {
      const run = await louez([...RECORD, ...extra], { configDir, env });
      assert.equal(run.code, EXIT.person, run.err());
      const { command, note } = printed(run.err());
      assert.doesNotMatch(command, /lz_|LOUEZ_API_KEY|--api-key|\$/, command);
      if (extra.includes("--api-url")) assert.match(command, new RegExp(`--api-url ${server.url}`));
      assert.match(note, /^Run it with the same key as this command: /);
      assert.match(note, source);
      assert.doesNotMatch(note, /lz_/);
    }
  });
});

describe("a usage error never quotes a credential", () => {
  test("a malformed LOUEZ_API_KEY is reported before any other diagnostic", async () => {
    const run = await louez(["stores", "list", "lz_hello"], { env: { LOUEZ_API_KEY: "lz_hello" } });
    assert.equal(run.code, EXIT.usage);
    assert.match(run.err(), /LOUEZ_API_KEY is not a Louez API key/);
    assert.doesNotMatch(run.err(), /hello/);
  });

  test("an inline --api-key value is checked, even one that looks like an option", async () => {
    const run = await louez(["stores", "list", "--api-key=--malformed", "--malformed"]);
    assert.equal(run.code, EXIT.usage);
    assert.match(run.err(), /--api-key is not a Louez API key/);
    assert.doesNotMatch(run.err(), /malformed/);
  });

  test("an argument equal to a credential value is named by its position", async () => {
    // LOUEZ_API_KEY is malformed but unused: --api-key comes first.
    const run = await louez(["stores", "list", "lz_hello", "--api-key", KEY], {
      env: { LOUEZ_API_KEY: "lz_hello" },
    });
    assert.equal(run.code, EXIT.usage);
    assert.match(run.err(), /Unexpected argument at position 3\./);
    assert.doesNotMatch(run.err(), /hello/);
  });
});

describe("an empty idempotency key", () => {
  test("stops the command and sends nothing, where a key is optional or required", async () => {
    let sent = 0;
    const fetch: typeof globalThis.fetch = async () => {
      sent++;
      return Response.json({});
    };
    const create = {
      ...(await import("./manifest.generated.js")).manifest.operations.find(
        (o) => o.id === "record_payment",
      )!,
      idempotencyRequired: true as const,
    };
    const manifest: Manifest = {
      apiVersion: "test",
      groups: [{ name: "payments", title: "Payments", description: "" }],
      operations: [create],
    };
    for (const key of ["", "   "]) {
      for (const options of [{}, { manifest }]) {
        const run = await louez([...RECORD, "--idempotency-key", key], { ...options, fetch });
        assert.equal(run.code, EXIT.usage);
        assert.match(run.err(), /--idempotency-key is empty/);
      }
    }
    assert.equal(sent, 0);
  });
});

describe("JSON unicode escapes in an answer", () => {
  test("are decoded with the JSON before redaction: the key spelt with \\u escapes is redacted", async () => {
    const escaped = [...KEY]
      .map((c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`)
      .join("");
    await serve((_, response) => {
      response.writeHead(401, { "Content-Type": "application/json" });
      response.end(`{"code":"UNAUTHORIZED","message":"echo ${escaped}"}`);
    });
    const run = await louez(["stores", "list"]);
    assert.equal(run.code, EXIT.api);
    assert.match(run.err(), /"message":"echo \[redacted\]"/);
  });
});

describe("usage errors", () => {
  test("exit 2 without sending anything", async () => {
    let fetched = 0;
    const fetch: typeof globalThis.fetch = async () => {
      fetched++;
      return new Response("{}");
    };
    const cases: Array<[string[], Record<string, string | undefined>, RegExp]> = [
      [["nowhere"], {}, /Unknown command "nowhere"/],
      [["reservations", "explode"], {}, /Unknown action "explode"/],
      [["reservations", "list", "--colour", "red"], {}, /Unknown flag --colour/],
      [["payments", "record"], {}, /Missing <reservationId>/],
      [["stores", "list"], { LOUEZ_API_KEY: undefined }, /No API key/],
      [["stores", "list"], { LOUEZ_API_URL: "http://louez.example/api/v1" }, /not https/],
      [["api", "GET", "//evil.example/x"], {}, /single \//],
      [["api", "FETCH", "/x"], {}, /not one of/],
      [["api", "GET", "/../../outside"], {}, /"\." or "\.\." segment/],
      [["api", "GET", "/%2e%2e/outside"], {}, /"\." or "\.\." segment/],
      [["api", "GET", "/reservations%2F..%2Foutside"], {}, /encoded slash/],
      [["reservations", "get", ".."], {}, /may not be "\." or "\.\."/],
      [["reservations", "get", "."], {}, /may not be "\." or "\.\."/],
      [["reservations", "get", "a/b"], {}, /nor hold a slash/],
    ];
    for (const [argv, env, message] of cases) {
      const run = await louez(argv, { env, fetch });
      assert.equal(run.code, EXIT.usage, argv.join(" "));
      assert.match(run.err(), message);
      assert.equal(run.out(), "");
    }
    assert.equal(fetched, 0);
  });

  test("an http base URL elsewhere is used with --insecure", async () => {
    const seen: string[] = [];
    const fetch: typeof globalThis.fetch = async (input) => {
      seen.push(String(input));
      return Response.json({ items: [] });
    };
    const run = await louez(["stores", "list", "--insecure"], {
      env: { LOUEZ_API_URL: "http://louez.example/api/v1" },
      fetch,
    });
    assert.equal(run.code, EXIT.ok);
    assert.deepEqual(seen, ["http://louez.example/api/v1/stores"]);
  });
});

describe("a write a person must approve", () => {
  test("exits 3 with the link and the command to run once approved, which sends Louez-Confirmation", async () => {
    let approved = false;
    const server = await serve((request, response) => {
      if (approved && request.headers["louez-confirmation"] === "apr_1")
        sendJson(response, 200, payment);
      else sendJson(response, 412, approvalRequired("https://app.louez.test/handoffs/apr_1"));
    });
    const first = await louez([...RECORD, "--api-key", KEY], { env: { LOUEZ_API_KEY: undefined } });
    assert.equal(first.code, EXIT.person);
    assert.equal(first.out(), "");
    assert.match(
      first.err(),
      /needs a person's approval\. Nothing was done\. Open:\n {2}https:\/\/app\.louez\.test\/handoffs\/apr_1\n/,
    );
    const command = /Once it is approved, run:\n {2}(.+)\n/.exec(first.err())?.[1];
    assert.equal(
      command,
      `louez payments record r1 --type rental --amount 10.00 --method cash --confirmation apr_1`,
    );

    approved = true;
    const again = await louez([...RECORD, "--confirmation", "apr_1"]);
    assert.equal(again.code, EXIT.ok);
    assert.deepEqual(JSON.parse(again.out()), payment);
    assert.equal(server.received[1]!.headers["louez-confirmation"], "apr_1");
  });

  test("exits 3 while the approval is pending, and for a confirmation, with the token to send", async () => {
    await serve((request, response) => {
      if (request.headers["louez-confirmation"]) {
        sendJson(
          response,
          412,
          apiErrorBody(
            412,
            "APPROVAL_PENDING",
            "Not decided yet.",
            {
              approval: {
                id: "apr_1",
                url: "https://app.louez.test/handoffs/apr_1",
                status: "pending",
              },
            },
            true,
          ),
        );
      } else {
        sendJson(
          response,
          412,
          apiErrorBody(412, "CONFIRMATION_REQUIRED", "Deleting this product hides it.", {
            preview: { summary: "Delete Tent" },
            confirmationToken: "tok_43",
          }),
        );
      }
    });
    const pending = await louez([...RECORD, "--confirmation", "apr_1"]);
    assert.equal(pending.code, EXIT.person);
    assert.match(pending.err(), /not decided yet/);
    assert.match(pending.err(), /--method cash --confirmation apr_1\n/);

    const confirm = await louez(["products", "delete", "p1"]);
    assert.equal(confirm.code, EXIT.person);
    assert.match(
      confirm.err(),
      /Check data\.details\.preview, then run:\n {2}louez products delete p1 --confirmation tok_43\n/,
    );
  });

  test("puts a body read from standard input in the command to run again", () => {
    assert.equal(
      rerunCommand(
        ["payments", "record", "r1", "--json", "-", "--wait"],
        "apr_1",
        '{ "note": "it\'s" }',
      ),
      `louez payments record r1 --json '{"note":"it'\\''s"}' --confirmation apr_1`,
    );
  });
});

describe("--wait", () => {
  /** An API whose approval is read as `statuses`, one per read, then carried out once approved. */
  async function approvalApi(
    statuses: Array<Record<string, unknown>>,
    pollAfterSeconds = 30,
    expiresAt?: string,
  ) {
    const reads = [...statuses];
    return serve((request, response) => {
      if (request.method === "GET" && request.url === "/api/v1/handoffs/apr_1") {
        sendJson(response, 200, {
          id: "apr_1",
          kind: "operation_approval",
          failure: null,
          decision: null,
          ...reads.shift(),
        });
      } else if (request.headers["louez-confirmation"] === "apr_1") {
        sendJson(response, 200, payment, { "Louez-Operation-Id": "op_1" });
      } else {
        sendJson(
          response,
          412,
          approvalRequired("https://app.louez.test/handoffs/apr_1", pollAfterSeconds, expiresAt),
        );
      }
    });
  }

  test("reads the approval every 30 seconds until approved, then carries the write out once, with the same idempotency key", async () => {
    const server = await approvalApi([
      { status: "pending" },
      { status: "opened" },
      { status: "approved" },
    ]);
    const run = await louez([...RECORD, "--wait"]);
    assert.equal(run.code, EXIT.ok);
    assert.deepEqual(JSON.parse(run.out()), payment);
    assert.match(run.err(), /Open:\n {2}https:\/\/app\.louez\.test\/handoffs\/apr_1\n/);
    assert.deepEqual(run.sleeps, [30_000, 30_000, 30_000]);
    assert.deepEqual(
      server.received.map(
        (request) =>
          `${request.method} ${request.url} ${request.headers["louez-confirmation"] ?? "-"} ${request.headers["idempotency-key"] ?? "-"}`,
      ),
      [
        "POST /api/v1/reservations/r1/payments - generated-key-1",
        "GET /api/v1/handoffs/apr_1 - -",
        "GET /api/v1/handoffs/apr_1 - -",
        "GET /api/v1/handoffs/apr_1 - -",
        "POST /api/v1/reservations/r1/payments apr_1 generated-key-1",
      ],
    );
  });

  test("never reads faster than every 30 seconds, and slower when the answer asks", async () => {
    await approvalApi([{ status: "approved" }], 5);
    assert.deepEqual((await louez([...RECORD, "--wait"])).sleeps, [APPROVAL_POLL_SECONDS * 1000]);
    await api!.close();
    await approvalApi([{ status: "pending" }, { status: "approved" }], 90);
    assert.deepEqual((await louez([...RECORD, "--wait"])).sleeps, [90_000, 90_000]);
  });

  test("stops on a refusal, and does nothing", async () => {
    const server = await approvalApi([
      {
        status: "failed",
        failure: { code: "declined", message: "Refused." },
        decision: { outcome: "refused", reason: "Wrong amount" },
      },
    ]);
    const run = await louez([...RECORD, "--wait"]);
    assert.equal(run.code, EXIT.api);
    assert.match(run.err(), /the person refused, saying "Wrong amount"\. Nothing was done\./);
    assert.equal(server.received.filter((request) => request.method === "POST").length, 1);
  });

  test("stops when the approval expires undecided, and does nothing", async () => {
    // Two reads fit before it expires, 75 seconds after the clock's start.
    const server = await approvalApi(
      Array.from({ length: 10 }, () => ({ status: "pending" })),
      30,
      "2026-11-15T10:01:15Z",
    );
    const run = await louez([...RECORD, "--wait"]);
    assert.equal(run.code, EXIT.api);
    assert.match(run.err(), /expired undecided/);
    assert.equal(server.received.filter((request) => request.method === "GET").length, 2);
    assert.equal(server.received.filter((request) => request.method === "POST").length, 1);
  });
});

describe("Ctrl-C while waiting", () => {
  /** Reads `pending`, then `approved`: a write would be carried out on the second read. */
  const api2 = () =>
    serve((request, response) => {
      if (request.method === "GET") {
        const reads = server.received.filter((r) => r.method === "GET").length;
        sendJson(response, 200, {
          id: "apr_1",
          kind: "operation_approval",
          status: reads === 1 ? "pending" : "approved",
          failure: null,
          decision: null,
        });
      } else if (request.headers["louez-confirmation"] === "apr_1") {
        sendJson(response, 200, payment);
      } else {
        sendJson(response, 412, approvalRequired("https://app.louez.test/handoffs/apr_1"));
      }
    });
  let server: FakeApi;

  test("ends the wait: the approval stays open, nothing is carried out, exit 3 with the command to run", async () => {
    for (const interruptOnSleep of [1, 2]) {
      server = await api2();
      const run = await louez([...RECORD, "--wait"], { interruptOnSleep });
      assert.equal(run.code, EXIT.person);
      assert.match(run.err(), /stopped waiting\. Nothing was done, and the approval stays open/);
      assert.match(run.err(), /--method cash --confirmation apr_1\n/);
      // Interrupted during the first or the second wait: as many reads before it, and no write after.
      assert.equal(server.received.filter((r) => r.method === "GET").length, interruptOnSleep - 1);
      assert.equal(server.received.filter((r) => r.method === "POST").length, 1);
      await server.close();
      api = undefined;
    }
  });
});

describe("auth", () => {
  const stores = {
    items: [{ id: "st_1", name: "Test store", slug: "test", role: "owner", links: {} }],
    nextCursor: null,
  };

  test("login checks the key, then saves it readable by its owner alone; status names its store; logout removes it", async () => {
    const server = await serve((request, response) =>
      request.headers.authorization === `Bearer ${KEY}`
        ? sendJson(response, 200, stores)
        : sendJson(response, 401, apiErrorBody(401, "UNAUTHENTICATED", "No valid API key.")),
    );
    const configDir = await tempDir();
    const env = { LOUEZ_API_KEY: undefined };

    const login = await louez(["auth", "login"], { configDir, env, stdin: `${KEY}\n` });
    assert.equal(login.code, EXIT.ok);
    assert.deepEqual(JSON.parse(login.out()).store, {
      id: "st_1",
      name: "Test store",
      slug: "test",
      role: "owner",
    });
    assert.equal(server.received[0]!.url, "/api/v1/stores");
    const file = configFile(configDir);
    assert.equal((await stat(file)).mode & 0o777, 0o600);
    assert.equal(JSON.parse(await readFile(file, "utf8")).apiKey, KEY);

    const status = await louez(["auth", "status"], { configDir, env });
    assert.equal(status.code, EXIT.ok);
    assert.deepEqual(JSON.parse(status.out()), {
      apiUrl: server.url,
      key: { source: file },
      store: { id: "st_1", name: "Test store", slug: "test", role: "owner" },
    });

    // Without LOUEZ_API_KEY, calls use the saved key.
    const call = await louez(["stores", "list"], { configDir, env });
    assert.equal(call.code, EXIT.ok);

    const logout = await louez(["auth", "logout"], { configDir, env });
    assert.deepEqual(JSON.parse(logout.out()), { removed: true, file });
    await assert.rejects(stat(file));
    assert.equal((await louez(["stores", "list"], { configDir, env })).code, EXIT.usage);
  });

  test("login tightens a config file others could read", async () => {
    await serve((_, response) => sendJson(response, 200, stores));
    const configDir = await tempDir();
    await mkdir(configDir, { recursive: true });
    await writeFile(configFile(configDir), '{"apiUrl":"https://app.louez.test/api/v1"}');
    await chmod(configFile(configDir), 0o644);
    const login = await louez(["auth", "login"], { configDir, stdin: KEY });
    assert.equal(login.code, EXIT.ok);
    assert.equal((await stat(configFile(configDir))).mode & 0o777, 0o600);
  });

  test("login asks on a terminal, and saves nothing the API refuses", async () => {
    await serve((_, response) =>
      sendJson(response, 401, apiErrorBody(401, "UNAUTHENTICATED", "No valid API key.")),
    );
    const configDir = await tempDir();
    const refused = await louez(["auth", "login"], {
      configDir,
      secret: "lz_revk_RevokedRevokedRevoke",
    });
    assert.equal(refused.code, EXIT.api);
    assert.match(refused.err(), /the key was not saved/);
    await assert.rejects(stat(configFile(configDir)));

    const notAKey = await louez(["auth", "login"], { configDir, stdin: "hello" });
    assert.equal(notAKey.code, EXIT.usage);
    await assert.rejects(stat(configFile(configDir)));
  });
});

describe("help", () => {
  test("lists the groups, the flags and the exit codes; a group's actions; an action's flags", async () => {
    const top = await louez(["--help"]);
    assert.equal(top.code, EXIT.ok);
    assert.match(top.out(), /\n {2}reservations +Rental requests/);
    assert.match(
      top.out(),
      /Exit codes:\n {2}0 .*\n {2}1 .*\n {2}2 [\s\S]*?\n {2}3 [\s\S]*?\n {2}4 /,
    );
    // The key on the command line is visible to others: the option says so.
    assert.match(
      top.out(),
      /--api-key <key> [\s\S]*list of processes[\s\S]*history[\s\S]*LOUEZ_API_KEY/,
    );

    const group = await louez(["payments", "--help"]);
    assert.match(group.out(), /record <reservationId> +Record Payment/);

    const action = await louez(["payments", "record", "--help"]);
    assert.match(
      action.out(),
      /^Record Payment\n\n {2}POST \/reservations\/\{reservationId\}\/payments/,
    );
    assert.match(
      action.out(),
      /--type <value> +\(required; one of rental, deposit, deposit_return, damage,/,
    );
    assert.match(action.out(), /Operation id \(MCP tool\): record_payment/);

    const version = await louez(["--version"]);
    assert.match(version.out(), /^louez \d+\.\d+\.\d+ \(API .+\)\n$/);

    const nothing = await louez([]);
    assert.equal(nothing.code, EXIT.usage);
    assert.equal(nothing.out(), "");
  });
});
