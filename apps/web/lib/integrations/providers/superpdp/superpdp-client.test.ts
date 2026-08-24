import assert from "node:assert/strict";
import { test } from "node:test";

import { SuperPdpApiError, isSuperPdpPendingValidationError } from "./superpdp-client";

test("recognizes the Super PDP account-validation response", () => {
  const error = new SuperPdpApiError(
    'Super PDP invoice event listing failed (403): {"http_status_code":403,"message":"User account is being validated"}',
    403,
    "invoice event listing",
  );

  assert.equal(isSuperPdpPendingValidationError(error), true);
});

test("matches the validation message case-insensitively", () => {
  const error = new SuperPdpApiError(
    "Super PDP company lookup failed (403): USER ACCOUNT IS BEING VALIDATED",
    403,
    "company lookup",
  );

  assert.equal(isSuperPdpPendingValidationError(error), true);
});

test("rejects other Super PDP and generic errors", () => {
  assert.equal(
    isSuperPdpPendingValidationError(
      new SuperPdpApiError("Super PDP request failed (403): Forbidden", 403, "request"),
    ),
    false,
  );
  assert.equal(
    isSuperPdpPendingValidationError(
      new SuperPdpApiError("User account is being validated", 401, "request"),
    ),
    false,
  );
  assert.equal(
    isSuperPdpPendingValidationError(new Error("User account is being validated")),
    false,
  );
});
