import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { test } from "node:test";

import { passkey } from "@better-auth/passkey";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { createAuthMiddleware } from "better-auth/api";
import { z } from "zod";

import { createPasskeyOptions, passkeyAfter, passkeyBefore } from "./passkey";

const ORIGIN = "https://app.example.com";

test("missing runtime configuration never trusts an origin supplied by the browser", () => {
  const options = createPasskeyOptions(undefined);
  assert.deepEqual(options?.origin, []);
  assert.equal(options?.rpID, "passkeys.invalid");
  assert.equal(createPasskeyOptions("https://app.example.com/")?.origin, ORIGIN);
  assert.equal(createPasskeyOptions("http://localhost:3000")?.rpID, "localhost");
});
const optionsSchema = z.object({
  challenge: z.string(),
  userVerification: z.string().optional(),
  rp: z.object({ id: z.string() }).optional(),
  rpId: z.string().optional(),
  authenticatorSelection: z
    .object({ residentKey: z.string(), userVerification: z.string() })
    .optional(),
  excludeCredentials: z.array(z.object({ id: z.string() })).optional(),
});
const passkeySchema = z.object({ id: z.string(), credentialID: z.string(), userId: z.string() });

const fixture = async () => {
  const data: Record<string, Record<string, unknown>[]> = {
    user: [],
    session: [],
    account: [],
    verification: [],
    passkey: [],
  };
  const auth = betterAuth({
    baseURL: ORIGIN,
    secret: "passkey-test-secret-never-used-in-production-1234567890",
    trustedOrigins: [ORIGIN],
    database: memoryAdapter(data),
    advanced: {
      database: { generateId: () => randomBytes(16).toString("base64url").slice(0, 21) },
    },
    emailAndPassword: { enabled: true },
    session: { cookieCache: { enabled: true, maxAge: 300 } },
    rateLimit: { enabled: false },
    logger: { disabled: true },
    plugins: [passkey(createPasskeyOptions(ORIGIN))],
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        await passkeyBefore(ctx);
      }),
      after: createAuthMiddleware(async (ctx) => {
        if (ctx.path.startsWith("/passkey/")) return passkeyAfter(ctx);
      }),
    },
  });

  const jar = new Map<string, string>();
  const request = async (path: string, body?: object, headers: Record<string, string> = {}) => {
    const response = await auth.handler(
      new Request(`${ORIGIN}/api/auth${path}`, {
        method: body ? "POST" : "GET",
        headers: {
          "content-type": "application/json",
          origin: ORIGIN,
          cookie: [...jar].map(([key, value]) => `${key}=${value}`).join("; "),
          ...headers,
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      }),
    );
    for (const cookie of response.headers.getSetCookie()) {
      const [nameValue] = cookie.split(";");
      const separator = nameValue.indexOf("=");
      jar.set(nameValue.slice(0, separator), nameValue.slice(separator + 1));
    }
    return response;
  };
  const signup = await request("/sign-up/email", {
    email: "owner@example.com",
    password: "Test-only-password-123!",
    name: "Owner",
  });
  assert.equal(signup.status, 200, await signup.text());
  return { auth, data, jar, request };
};

/** Minimal CTAP2 CBOR for a none-attestation software authenticator, only in tests. */
type CborValue = string | number | Buffer | Map<string | number, CborValue>;
const cbor = (value: CborValue): Buffer => {
  const length = (major: number, n: number) =>
    n < 24
      ? Buffer.from([(major << 5) | n])
      : n < 256
        ? Buffer.from([(major << 5) | 24, n])
        : Buffer.from([(major << 5) | 25, n >> 8, n & 255]);
  if (typeof value === "number") return value >= 0 ? length(0, value) : length(1, -1 - value);
  if (typeof value === "string")
    return Buffer.concat([length(3, Buffer.byteLength(value)), Buffer.from(value)]);
  if (Buffer.isBuffer(value)) return Buffer.concat([length(2, value.length), value]);
  return Buffer.concat([
    length(5, value.size),
    ...[...value].flatMap(([key, item]) => [cbor(key), cbor(item)]),
  ]);
};

const authenticator = () => {
  const key = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = z
    .object({ x: z.string(), y: z.string() })
    .parse(key.publicKey.export({ format: "jwk" }));
  const credentialId = randomBytes(32);
  const coseKey = cbor(
    new Map<string | number, CborValue>([
      [1, 2],
      [3, -7],
      [-1, 1],
      [-2, Buffer.from(jwk.x, "base64url")],
      [-3, Buffer.from(jwk.y, "base64url")],
    ]),
  );
  const rpHash = createHash("sha256").update("app.example.com").digest();
  const clientData = (type: string, challenge: string, origin: string) =>
    Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }));
  return {
    id: credentialId.toString("base64url"),
    register: (challenge: string, userVerified = true, origin = ORIGIN) => {
      const authData = Buffer.concat([
        rpHash,
        Buffer.from([userVerified ? 0x45 : 0x41]),
        Buffer.alloc(4),
        Buffer.alloc(16),
        Buffer.from([0, credentialId.length]),
        credentialId,
        coseKey,
      ]);
      return {
        id: credentialId.toString("base64url"),
        rawId: credentialId.toString("base64url"),
        type: "public-key",
        response: {
          clientDataJSON: clientData("webauthn.create", challenge, origin).toString("base64url"),
          attestationObject: cbor(
            new Map<string | number, CborValue>([
              ["fmt", "none"],
              ["attStmt", new Map()],
              ["authData", authData],
            ]),
          ).toString("base64url"),
          transports: ["internal"],
        },
        clientExtensionResults: {},
      };
    },
    authenticate: (challenge: string, userVerified = true, origin = ORIGIN, counter = 1) => {
      const count = Buffer.alloc(4);
      count.writeUInt32BE(counter);
      const authData = Buffer.concat([rpHash, Buffer.from([userVerified ? 0x05 : 0x01]), count]);
      const client = clientData("webauthn.get", challenge, origin);
      const signature = sign(
        "sha256",
        Buffer.concat([authData, createHash("sha256").update(client).digest()]),
        key.privateKey,
      );
      return {
        id: credentialId.toString("base64url"),
        rawId: credentialId.toString("base64url"),
        type: "public-key",
        response: {
          clientDataJSON: client.toString("base64url"),
          authenticatorData: authData.toString("base64url"),
          signature: signature.toString("base64url"),
        },
        clientExtensionResults: {},
      };
    },
  };
};

const enroll = async (f: Awaited<ReturnType<typeof fixture>>, device = authenticator()) => {
  const options = optionsSchema.parse(
    await (await f.request("/passkey/generate-register-options")).json(),
  );
  const response = await f.request("/passkey/verify-registration", {
    response: device.register(options.challenge),
  });
  assert.equal(response.status, 200);
  return { device, passkey: passkeySchema.parse(await response.json()) };
};

test("registration and sign-in require verified user presence; challenges are single-use", async () => {
  const f = await fixture();
  const { device, passkey: registered } = await enroll(f);
  assert.equal(f.data.passkey.length, 1);
  assert.equal(
    (await f.request("/passkey/update-passkey", { id: registered.id, name: "My laptop" })).status,
    200,
  );
  const duplicateOptions = optionsSchema.parse(
    await (await f.request("/passkey/generate-register-options")).json(),
  );
  assert.deepEqual(
    duplicateOptions.excludeCredentials?.map((credential) => credential.id),
    [device.id],
  );
  assert.deepEqual(duplicateOptions.authenticatorSelection?.residentKey, "required");
  assert.equal(duplicateOptions.authenticatorSelection?.userVerification, "required");
  assert.equal(duplicateOptions.rp?.id, "app.example.com");

  f.jar.clear();
  const options = optionsSchema.parse(
    await (await f.request("/passkey/generate-authenticate-options")).json(),
  );
  assert.equal(options.userVerification, "required");
  assert.equal(options.rpId, "app.example.com");
  const body = { response: device.authenticate(options.challenge) };
  const response = await f.request("/passkey/verify-authentication", body);
  assert.equal(response.status, 200, await response.text());
  assert.equal(f.data.passkey[0].counter, 1);
  const sessionsBeforeReplay = f.data.session.length;
  assert.equal((await f.request("/passkey/verify-authentication", body)).status, 400);
  assert.equal(f.data.session.length, sessionsBeforeReplay);
  assert.equal((await f.request("/passkey/delete-passkey", { id: registered.id })).status, 200);
  assert.equal(f.data.passkey.length, 0);
});

test("rejects registration without device verification, from another origin, or with an expired challenge", async () => {
  for (const scenario of ["unverified", "origin", "expired"]) {
    const f = await fixture();
    const options = optionsSchema.parse(
      await (await f.request("/passkey/generate-register-options")).json(),
    );
    if (scenario === "expired") f.data.verification[0].expiresAt = new Date(0);
    const response = await f.request("/passkey/verify-registration", {
      response: authenticator().register(
        options.challenge,
        scenario !== "unverified",
        scenario === "origin" ? "https://tenant.example.com" : ORIGIN,
      ),
    });
    assert.notEqual(response.status, 200, scenario);
    assert.equal(f.data.passkey.length, 0, scenario);
  }
});

test("rejects unverified, wrong-origin and tampered sign-in assertions before creating a session", async () => {
  const f = await fixture();
  const { device } = await enroll(f);
  for (const scenario of ["unverified", "origin", "signature", "challenge"]) {
    f.jar.clear();
    const options = optionsSchema.parse(
      await (await f.request("/passkey/generate-authenticate-options")).json(),
    );
    const response = device.authenticate(
      scenario === "challenge" ? "wrong-challenge" : options.challenge,
      scenario !== "unverified",
      scenario === "origin" ? "https://tenant.example.com" : ORIGIN,
    );
    if (scenario === "signature")
      response.response.signature = randomBytes(72).toString("base64url");
    const previousSessions = f.data.session.length;
    assert.notEqual(
      (await f.request("/passkey/verify-authentication", { response })).status,
      200,
      scenario,
    );
    assert.equal(f.data.session.length, previousSessions, scenario);
    assert.equal(f.data.passkey[0].counter, 0, scenario);
  }
});

test("registration, rename and deletion reject stale sessions; a revoked cookie cache grants no access", async () => {
  const f = await fixture();
  const { passkey: registered } = await enroll(f);
  f.data.session[0].createdAt = new Date(Date.now() - 11 * 60 * 1000);
  for (const [path, body] of [
    ["/passkey/generate-register-options", undefined],
    ["/passkey/verify-registration", { response: {} }],
    ["/passkey/update-passkey", { id: registered.id, name: "new name" }],
    ["/passkey/delete-passkey", { id: registered.id }],
  ] satisfies [string, object | undefined][]) {
    const response = await f.request(path, body);
    assert.equal(response.status, 403, path);
    assert.equal((await response.json()).code, "SESSION_NOT_FRESH");
  }
  f.data.session.length = 0;
  assert.equal((await f.request("/passkey/list-user-passkeys")).status, 401);
  assert.equal((await f.request("/passkey/delete-passkey", { id: registered.id })).status, 401);
  assert.equal(f.data.passkey.length, 1);
});

test("an account cannot delete, rename, or finish registering another account's credential", async () => {
  const f = await fixture();
  const { passkey: registered, device } = await enroll(f);
  const options = optionsSchema.parse(
    await (await f.request("/passkey/generate-register-options")).json(),
  );
  // Switch only the session cookies: retain the first user's challenge cookie.
  for (const key of f.jar.keys()) if (key.includes("session")) f.jar.delete(key);
  const second = await f.request("/sign-up/email", {
    email: "other@example.com",
    password: "Other-test-password-123!",
    name: "Other",
  });
  assert.equal(second.status, 200);
  assert.notEqual((await f.request("/passkey/delete-passkey", { id: registered.id })).status, 200);
  assert.notEqual(
    (await f.request("/passkey/update-passkey", { id: registered.id, name: "stolen" })).status,
    200,
  );
  assert.equal(
    (
      await f.request("/passkey/verify-registration", {
        response: device.register(options.challenge),
      })
    ).status,
    401,
  );
  assert.equal(f.data.passkey.length, 1);
  assert.deepEqual(await (await f.request("/passkey/list-user-passkeys")).json(), []);
});

test("bounds passkey labels and rejects requests from untrusted origins", async () => {
  const f = await fixture();
  assert.equal(
    (await f.request(`/passkey/generate-register-options?name=${"a".repeat(101)}`)).status,
    400,
  );
  assert.equal(
    (await f.request("/passkey/verify-registration", { name: "a".repeat(101), response: {} }))
      .status,
    400,
  );
  assert.equal(
    (await f.request("/passkey/delete-passkey", { id: "test" }, { origin: "https://evil.example" }))
      .status,
    403,
  );
});

test("supports synced zero-counter credentials and rejects expired authentication challenges", async () => {
  const f = await fixture();
  const { device } = await enroll(f);
  for (let i = 0; i < 2; i++) {
    f.jar.clear();
    const options = optionsSchema.parse(
      await (await f.request("/passkey/generate-authenticate-options")).json(),
    );
    const response = await f.request("/passkey/verify-authentication", {
      response: device.authenticate(options.challenge, true, ORIGIN, 0),
    });
    assert.equal(response.status, 200);
  }
  f.jar.clear();
  const options = optionsSchema.parse(
    await (await f.request("/passkey/generate-authenticate-options")).json(),
  );
  for (const challenge of f.data.verification) challenge.expiresAt = new Date(0);
  const before = f.data.session.length;
  assert.equal(
    (
      await f.request("/passkey/verify-authentication", {
        response: device.authenticate(options.challenge, true, ORIGIN, 0),
      })
    ).status,
    400,
  );
  assert.equal(f.data.session.length, before);
});
