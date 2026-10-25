import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { type IncomingMessage, type ServerResponse, createServer } from "node:http";

// A fake billing service for the database tests. It checks request signatures and
// signs its answers as louez-billing docs/api README §4 describes, with its own code
// rather than Louez's client, so the tests check the client against the contract.

export type FakeRequest = {
  readonly method: string;
  /** The request target, path and query, as received. */
  readonly target: string;
  readonly headers: IncomingMessage["headers"];
  readonly body: Buffer;
  /** Whether the Louez signature was valid. */
  readonly verified: boolean;
  readonly signature: string;
  json(): unknown;
};

export type FakeReply = {
  readonly status: number;
  /** A value to JSON-encode, a raw string, or nothing (304). */
  readonly body?: unknown;
  readonly headers?: Record<string, string>;
  /** Defaults to true, as the service signs every authenticated answer. */
  readonly signed?: boolean;
};

export type FakeHandler = (request: FakeRequest) => FakeReply | Promise<FakeReply>;

export type FakeBillingService = {
  readonly origin: string;
  readonly requests: FakeRequest[];
  /** The variables Louez needs to call this fake. */
  readonly env: Record<string, string>;
  handle(path: string, handler: FakeHandler): void;
  close(): Promise<void>;
};

const sha256 = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
const hmac = (secret: string, text: string) =>
  createHmac("sha256", Buffer.from(secret, "utf8")).update(text, "utf8").digest("hex");

function readBody(request: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

function header(request: IncomingMessage, name: string): string {
  const value = request.headers[name];
  return typeof value === "string" ? value : "";
}

export async function startFakeBillingService(): Promise<FakeBillingService> {
  const requestKid = "louez-req-fake";
  const requestSecret = randomBytes(32).toString("base64");
  const responseKid = "billing-res-fake";
  const responseSecret = randomBytes(32).toString("base64");
  const handlers = new Map<string, FakeHandler>();
  const requests: FakeRequest[] = [];
  let host = "";

  const verify = (request: IncomingMessage, body: Buffer): boolean => {
    const timestamp = header(request, "louez-timestamp");
    const signature = header(request, "louez-signature");
    if (
      header(request, "louez-key-id") !== requestKid ||
      header(request, "louez-contract") !== "1"
    ) {
      return false;
    }
    if (!/^[1-9][0-9]{0,11}$/.test(timestamp) || !/^[0-9a-f]{64}$/.test(signature)) return false;
    if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
    if (request.method === "POST" && header(request, "content-type") !== "application/json") {
      return false;
    }
    const signed = [
      "louez-billing.req.v1",
      timestamp,
      request.method ?? "",
      `${host}${request.url ?? ""}`,
      "1",
      header(request, "if-none-match"),
      sha256(body),
    ].join("\n");
    return timingSafeEqual(
      Buffer.from(hmac(requestSecret, signed), "hex"),
      Buffer.from(signature, "hex"),
    );
  };

  const reply = (response: ServerResponse, request: FakeRequest, answer: FakeReply) => {
    const body =
      answer.body === undefined
        ? Buffer.alloc(0)
        : Buffer.from(typeof answer.body === "string" ? answer.body : JSON.stringify(answer.body));
    const headers: Record<string, string> = {
      "Billing-Request-Id": `req_${randomBytes(6).toString("hex")}`,
      ...answer.headers,
    };
    if (body.length > 0) headers["Content-Type"] = "application/json";
    if (answer.signed ?? true) {
      const timestamp = String(Math.floor(Date.now() / 1000));
      headers["Billing-Key-Id"] = responseKid;
      headers["Billing-Timestamp"] = timestamp;
      headers["Billing-Signature"] = hmac(
        responseSecret,
        [
          "louez-billing.res.v1",
          timestamp,
          String(answer.status),
          request.signature,
          sha256(body),
        ].join("\n"),
      );
    }
    response.writeHead(answer.status, headers);
    response.end(body);
  };

  const server = createServer((incoming, response) => {
    void (async () => {
      const body = await readBody(incoming);
      const target = incoming.url ?? "";
      const path = target.split("?")[0] ?? "";
      if (path === "/api/v1/louez/health") {
        const handler = handlers.get("/health");
        const answer = handler
          ? await handler({
              method: incoming.method ?? "",
              target,
              headers: incoming.headers,
              body,
              verified: true,
              signature: "",
              json: () => null,
            })
          : { status: 200, body: { status: "ok", time: new Date().toISOString() } };
        response.writeHead(answer.status, { "Content-Type": "application/json" });
        response.end(JSON.stringify(answer.body ?? {}));
        return;
      }
      const request: FakeRequest = {
        method: incoming.method ?? "",
        target,
        headers: incoming.headers,
        body,
        verified: verify(incoming, body),
        signature: header(incoming, "louez-signature"),
        json: () => JSON.parse(body.toString("utf8")),
      };
      requests.push(request);
      if (!request.verified) {
        reply(response, request, {
          status: 401,
          body: { code: "invalid_signature" },
          signed: false,
        });
        return;
      }
      const handler = handlers.get(path.replace("/api/v1/louez", ""));
      if (!handler) {
        reply(response, request, { status: 404, body: { code: "not_found" } });
        return;
      }
      reply(response, request, await handler(request));
    })().catch((error: unknown) => {
      response.writeHead(500);
      response.end(String(error));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = address !== null && typeof address === "object" ? address.port : 0;
  host = `127.0.0.1:${port}`;
  const origin = `http://${host}`;

  return {
    origin,
    requests,
    env: {
      LOUEZ_BILLING: "cloud",
      BILLING_SERVICE_URL: origin,
      BILLING_OUTBOUND_KEYS: JSON.stringify({ [requestKid]: requestSecret }),
      BILLING_OUTBOUND_ACTIVE_KID: requestKid,
      BILLING_RESPONSE_KEYS: JSON.stringify({ [responseKid]: responseSecret }),
      BILLING_NEW_STORES_FROM: "2027-01-25T00:00:00Z",
    },
    handle(path, handler) {
      handlers.set(path, handler);
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        // fetch keeps idle sockets open; close them so the server can stop.
        server.closeAllConnections();
      }),
  };
}

/** Sets the fake's variables, returning a function that restores the previous ones. */
export function useFakeServiceEnv(service: FakeBillingService): () => void {
  const previous = Object.keys(service.env).map((name) => [name, process.env[name]] as const);
  Object.assign(process.env, service.env);
  return () => {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  };
}

/** A test log that keeps every line, and a Discord stub that records each call. */
export function captureAlerts() {
  const errors: string[] = [];
  const infos: string[] = [];
  const notified: string[] = [];
  return {
    errors,
    infos,
    notified,
    log: {
      error: (_tag: string, message: string) => errors.push(message),
      info: (_tag: string, message: string) => infos.push(message),
    },
    notify: async (kind: string) => {
      notified.push(kind);
    },
  };
}
