import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { describeHostingMisconfiguration, getHostedBy, isSelfHosted } from "./hosting";

// LOUEZ_HOSTED_BY (louez-billing docs/plans/design.md §7.1): the hosting identity is its
// own variable, so neither billing nor the deployment mode decides it.

const initial = { hostedBy: process.env.LOUEZ_HOSTED_BY, mode: process.env.LOUEZ_MODE };
afterEach(() => {
  if (initial.hostedBy === undefined) delete process.env.LOUEZ_HOSTED_BY;
  else process.env.LOUEZ_HOSTED_BY = initial.hostedBy;
  if (initial.mode === undefined) delete process.env.LOUEZ_MODE;
  else process.env.LOUEZ_MODE = initial.mode;
});

test("an instance is self-hosted unless it names a known host", () => {
  delete process.env.LOUEZ_HOSTED_BY;
  assert.equal(getHostedBy(), null);
  assert.equal(isSelfHosted(), true);
  // A multi-store self-host is still self-hosted.
  process.env.LOUEZ_MODE = "platform";
  assert.equal(isSelfHosted(), true);

  process.env.LOUEZ_HOSTED_BY = "lumycloud";
  assert.equal(getHostedBy(), "lumycloud");
  assert.equal(isSelfHosted(), false);

  // Only reachable when SKIP_ENV_VALIDATION hands the raw value through.
  for (const raw of ["", "LumyCloud", "acme"]) {
    process.env.LOUEZ_HOSTED_BY = raw;
    assert.equal(getHostedBy(), null, JSON.stringify(raw));
  }
});

test("the cloud without a known host must stop; elsewhere an unknown host is logged", () => {
  const cloudUnset = describeHostingMisconfiguration({ louezBilling: "cloud", louezHostedBy: undefined });
  assert.equal(cloudUnset?.stop, true);
  assert.match(cloudUnset?.message ?? "", /LOUEZ_HOSTED_BY is not set/);
  const cloudUnknown = describeHostingMisconfiguration({ louezBilling: "cloud", louezHostedBy: "LumyCloud" });
  assert.equal(cloudUnknown?.stop, true);
  assert.match(cloudUnknown?.message ?? "", /not a known host/);

  const selfHostUnknown = describeHostingMisconfiguration({ louezBilling: undefined, louezHostedBy: "acme" });
  assert.equal(selfHostUnknown?.stop, false);
  assert.match(selfHostUnknown?.message ?? "", /not a known host/);

  assert.equal(
    describeHostingMisconfiguration({ louezBilling: "cloud", louezHostedBy: "lumycloud" }),
    null,
  );
  assert.equal(describeHostingMisconfiguration({ louezBilling: undefined, louezHostedBy: undefined }), null);
  assert.equal(describeHostingMisconfiguration({ louezBilling: "off", louezHostedBy: undefined }), null);
  assert.equal(describeHostingMisconfiguration({ louezBilling: "off", louezHostedBy: "lumycloud" }), null);
});
