import assert from "node:assert/strict";
import { chmod, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { after, afterEach, describe, test } from "node:test";

import { APPROVAL_POLL_SECONDS, EXIT, main, rerunCommand } from "./cli.js";
import { configFile } from "./config.js";
import {
  apiError,
  removeTempDirs,
  sendJson,
  startFakeApi,
  tempDir,
  testIo,
  type FakeApi,
  type Handler,
  type TestIo,
} from "./testing/fake-api.js";

const KEY = "lz_test_secret_key";

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
  apiError(
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
    const error = apiError(404, "PAYMENT_NOT_FOUND", "No payment with this id.");
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
        apiError(409, "OPERATION_IN_PROGRESS", "Still running.", undefined, true),
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
      env: { LOUEZ_API_KEY: "", LOUEZ_API_URL: server.url },
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
        [["stores", "list", "--api-url", other.url], { LOUEZ_API_KEY: "" }],
        [["stores", "list"], { LOUEZ_API_KEY: "", LOUEZ_API_URL: other.url }],
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
        env: { LOUEZ_API_KEY: "", LOUEZ_API_URL: "" },
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
        env: { LOUEZ_API_KEY: "lz_other_server_key", LOUEZ_API_URL: other.url },
      });
      assert.equal(run.code, EXIT.ok);
      assert.deepEqual(
        other.received.map((request) => request.headers.authorization),
        ["Bearer lz_other_server_key"],
      );
    } finally {
      await other.close();
    }
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
      ["api", "POST", "/reservations", "--json", "--api-key", "lz_SECRET_1234"],
      { fetch },
    );
    assert.equal(run.code, EXIT.usage);
    assert.match(run.err(), /--json needs a value/);
    assert.doesNotMatch(run.err() + run.out(), /lz_SECRET_1234/);
    assert.equal(fetched, 0);
  });

  test("every key given or in use is replaced wherever it appears, an API's answer included", async () => {
    const echoed = await louez(["stores", "list", "lz_SECRET_5678", "--api-key", "lz_SECRET_5678"]);
    assert.equal(echoed.code, EXIT.usage);
    assert.match(echoed.err(), /Unexpected argument "\[redacted\]"/);
    assert.doesNotMatch(echoed.err(), /lz_SECRET_5678/);

    // A server that quotes the request's credential back, in its message and as JSON.
    await serve((request, response) =>
      sendJson(
        response,
        401,
        apiError(401, "UNAUTHENTICATED", `Not a key: ${request.headers.authorization}`, {
          sent: request.headers.authorization,
        }),
      ),
    );
    const quoted = await louez(["stores", "list"]);
    assert.equal(quoted.code, EXIT.api);
    assert.match(quoted.err(), /Not a key: Bearer \[redacted\]/);
    assert.match(quoted.err(), /"sent":"Bearer \[redacted\]"/);

    // A key with a character JSON escapes is hidden in its JSON form too.
    const escaped = await louez(["stores", "list"], { env: { LOUEZ_API_KEY: 'lz_quote"key' } });
    assert.equal(escaped.code, EXIT.api);
    assert.match(escaped.err(), /"sent":"Bearer \[redacted\]"/);
    assert.doesNotMatch(escaped.err(), /lz_quote/);
  });
});

describe("usage errors", () => {
  test("exit 2 without sending anything", async () => {
    let fetched = 0;
    const fetch: typeof globalThis.fetch = async () => {
      fetched++;
      return new Response("{}");
    };
    const cases: Array<[string[], Record<string, string>, RegExp]> = [
      [["nowhere"], {}, /Unknown command "nowhere"/],
      [["reservations", "explode"], {}, /Unknown action "explode"/],
      [["reservations", "list", "--colour", "red"], {}, /Unknown flag --colour/],
      [["payments", "record"], {}, /Missing <reservationId>/],
      [["stores", "list"], { LOUEZ_API_KEY: "" }, /No API key/],
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
    const first = await louez([...RECORD, "--api-key", KEY], { env: { LOUEZ_API_KEY: "" } });
    assert.equal(first.code, EXIT.person);
    assert.equal(first.out(), "");
    assert.match(
      first.err(),
      /needs a person's approval\. Nothing was done\. Open:\n {2}https:\/\/app\.louez\.test\/handoffs\/apr_1\n/,
    );
    const command = /Once it is approved, run:\n {2}(.+)\n/.exec(first.err())?.[1];
    assert.equal(
      command,
      `louez payments record r1 --type rental --amount 10.00 --method cash --api-key "$LOUEZ_API_KEY" --confirmation apr_1`,
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
          apiError(
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
          apiError(412, "CONFIRMATION_REQUIRED", "Deleting this product hides it.", {
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
        : sendJson(response, 401, apiError(401, "UNAUTHENTICATED", "No valid API key.")),
    );
    const configDir = await tempDir();
    const env = { LOUEZ_API_KEY: "" };

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
      sendJson(response, 401, apiError(401, "UNAUTHENTICATED", "No valid API key.")),
    );
    const configDir = await tempDir();
    const refused = await louez(["auth", "login"], { configDir, secret: "lz_revoked" });
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
