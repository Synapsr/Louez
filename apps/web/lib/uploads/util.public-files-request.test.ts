import assert from "node:assert/strict";
import { test } from "node:test";

import { createPublicFilesRequest } from "./util.public-files-request";

const allowedOrigins = [
  "https://worktree-onboarding-redesign.louez.localify",
  "https://app.louez.app",
];

test("uses the trusted browser origin for proxied upload URLs", async () => {
  const request = new Request("https://localhost:52199/api/files/logo?op=presign", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: allowedOrigins[0],
    },
    body: JSON.stringify({ op: "presign" }),
  });

  const publicRequest = createPublicFilesRequest(request, allowedOrigins, allowedOrigins[1]);

  assert.equal(
    publicRequest.url,
    "https://worktree-onboarding-redesign.louez.localify/api/files/logo?op=presign",
  );
  assert.equal(publicRequest.method, "POST");
  assert.equal(await publicRequest.json().then((body) => body.op), "presign");
});

test("does not trust an external Origin header", () => {
  const request = new Request("https://localhost:52199/api/files/logo?op=presign", {
    headers: { origin: "https://evil.example" },
  });

  const publicRequest = createPublicFilesRequest(request, allowedOrigins, allowedOrigins[1]);

  assert.equal(publicRequest.url, "https://app.louez.app/api/files/logo?op=presign");
  assert.equal(publicRequest.headers.get("origin"), "https://evil.example");
});
