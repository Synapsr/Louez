import assert from "node:assert/strict";
import { createVerify, generateKeyPairSync } from "node:crypto";
import { describe, test } from "node:test";

import type { GoogleAdsConversionsConfig } from "./google-ads-config";
import {
  createDataManagerClient,
  DATA_MANAGER_INGEST_URL,
  DATA_MANAGER_SCOPE,
  DataManagerError,
  GOOGLE_TOKEN_URL,
  ingestRequestBody,
  type UploadedConversion,
} from "./google-data-manager";

// A key made for the test: the signature is checked against its public half.
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PRIVATE_KEY = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

const CONFIG: GoogleAdsConversionsConfig = {
  customerId: "1234567890",
  conversionActionId: "987654321",
  loginCustomerId: null,
  serviceAccount: {
    clientEmail: "uploader@louez-test.iam.gserviceaccount.com",
    privateKey: PRIVATE_KEY,
  },
};

const CONVERSION: UploadedConversion = {
  userId: "user_123",
  clickIdType: "gclid",
  clickId: "EAIaIQobChMI-test",
  convertedAt: new Date("2026-11-18T10:00:00.000Z"),
  adUserDataConsent: "denied",
  adPersonalizationConsent: "denied",
};

describe("ingestRequestBody", () => {
  test("one event on the conversion action, keyed on the account, with its click and consent", () => {
    assert.deepEqual(ingestRequestBody(CONFIG, CONVERSION), {
      destinations: [
        {
          operatingAccount: { accountType: "GOOGLE_ADS", accountId: "1234567890" },
          productDestinationId: "987654321",
        },
      ],
      events: [
        {
          transactionId: "user_123",
          eventTimestamp: "2026-11-18T10:00:00.000Z",
          eventSource: "WEB",
          adIdentifiers: { gclid: "EAIaIQobChMI-test" },
          consent: { adUserData: "CONSENT_DENIED", adPersonalization: "CONSENT_DENIED" },
        },
      ],
      validateOnly: false,
    });
  });

  test("a gbraid goes under its own name, a manager account as the login account", () => {
    const body = ingestRequestBody(
      { ...CONFIG, loginCustomerId: "1112223333" },
      {
        ...CONVERSION,
        clickIdType: "gbraid",
        clickId: "0AAAAA",
        adUserDataConsent: "granted",
        adPersonalizationConsent: "granted",
      },
      { validateOnly: true },
    );
    assert.deepEqual(body.destinations[0]?.loginAccount, {
      accountType: "GOOGLE_ADS",
      accountId: "1112223333",
    });
    assert.deepEqual(body.events[0]?.adIdentifiers, { gbraid: "0AAAAA" });
    assert.deepEqual(body.events[0]?.consent, {
      adUserData: "CONSENT_GRANTED",
      adPersonalization: "CONSENT_GRANTED",
    });
    assert.equal(body.validateOnly, true);
  });
});

type Call = { url: string; init: RequestInit };

/** A fetch that records each call and answers with the next response. */
function fakeFetch(responses: Array<() => Response>) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const next = responses.shift();
    if (!next) throw new Error("no more responses");
    return next();
  }) as typeof fetch;
  return { calls, fetchImpl };
}

const json = (status: number, body: unknown) => () =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("createDataManagerClient", () => {
  test("signs in as the service account, then posts the event with its token", async () => {
    const { calls, fetchImpl } = fakeFetch([
      json(200, { access_token: "ya29.test-token", expires_in: 3599 }),
      json(200, { requestId: "req-1" }),
      json(200, { requestId: "req-2" }),
    ]);
    const client = createDataManagerClient(CONFIG, {
      fetch: fetchImpl,
      now: () => Date.parse("2026-11-18T12:00:00Z"),
    });

    assert.deepEqual(await client.ingest(CONVERSION), { requestId: "req-1" });

    const [tokenCall, ingestCall] = calls;
    assert.equal(tokenCall?.url, GOOGLE_TOKEN_URL);
    const form = new URLSearchParams(String(tokenCall?.init.body));
    assert.equal(form.get("grant_type"), "urn:ietf:params:oauth:grant-type:jwt-bearer");
    const [header, claims, signature] = (form.get("assertion") ?? "").split(".");
    assert.deepEqual(JSON.parse(Buffer.from(claims ?? "", "base64url").toString()), {
      iss: "uploader@louez-test.iam.gserviceaccount.com",
      scope: DATA_MANAGER_SCOPE,
      aud: GOOGLE_TOKEN_URL,
      iat: Date.parse("2026-11-18T12:00:00Z") / 1000,
      exp: Date.parse("2026-11-18T12:00:00Z") / 1000 + 3600,
    });
    assert.ok(
      createVerify("RSA-SHA256")
        .update(`${header}.${claims}`)
        .verify(publicKey, Buffer.from(signature ?? "", "base64url")),
    );

    assert.equal(ingestCall?.url, DATA_MANAGER_INGEST_URL);
    assert.equal(ingestCall?.init.method, "POST");
    const headers = ingestCall?.init.headers as Record<string, string>;
    assert.equal(headers.authorization, "Bearer ya29.test-token");
    assert.deepEqual(
      JSON.parse(String(ingestCall?.init.body)),
      JSON.parse(JSON.stringify(ingestRequestBody(CONFIG, CONVERSION))),
    );

    // The token is reused while it lasts.
    assert.deepEqual(await client.ingest(CONVERSION), { requestId: "req-2" });
    assert.equal(calls.length, 3);
  });

  test("a refused upload throws Google's message and status, never the token or the key", async () => {
    const { fetchImpl } = fakeFetch([
      json(200, { access_token: "ya29.secret-token" }),
      json(400, {
        error: {
          code: 400,
          status: "INVALID_ARGUMENT",
          message: "There was a problem with the request.",
          details: [
            {
              "@type": "type.googleapis.com/google.rpc.BadRequest",
              fieldViolations: [
                {
                  field: "destinations[0].product_destination_id",
                  description: "Conversion action not found.",
                },
              ],
            },
          ],
        },
      }),
    ]);
    const client = createDataManagerClient(CONFIG, { fetch: fetchImpl });
    await assert.rejects(client.ingest(CONVERSION), (error: unknown) => {
      assert.ok(error instanceof DataManagerError);
      assert.equal(error.status, 400);
      assert.match(error.message, /INVALID_ARGUMENT/);
      assert.match(error.message, /product_destination_id: Conversion action not found/);
      assert.doesNotMatch(error.message, /secret-token|PRIVATE KEY/);
      return true;
    });
  });

  test("a refused token throws, and no upload is attempted", async () => {
    const { calls, fetchImpl } = fakeFetch([
      json(400, { error: "invalid_grant", error_description: "Invalid JWT Signature." }),
    ]);
    const client = createDataManagerClient(CONFIG, { fetch: fetchImpl });
    await assert.rejects(client.ingest(CONVERSION), /Token refused: HTTP 400 invalid_grant/);
    assert.equal(calls.length, 1);
  });

  test("no answer at all throws a DataManagerError without a status", async () => {
    const fetchImpl = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    const client = createDataManagerClient(CONFIG, { fetch: fetchImpl });
    await assert.rejects(client.ingest(CONVERSION), (error: unknown) => {
      assert.ok(error instanceof DataManagerError);
      assert.equal(error.status, null);
      assert.match(error.message, /No answer from oauth2\.googleapis\.com/);
      return true;
    });
  });
});
