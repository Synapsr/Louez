import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ANTHROPIC_EGRESS_RANGES,
  OPENAI_CHATGPT_EGRESS_RANGES,
  egressProviderOf,
} from "./provider-egress";

test("Anthropic's published outbound ranges, edges included", () => {
  assert.deepEqual(ANTHROPIC_EGRESS_RANGES, ["160.79.104.0/21", "153.61.208.0/20"]);
  for (const ip of [
    "160.79.104.0",
    "160.79.104.10",
    "160.79.111.255",
    "153.61.208.0",
    "153.61.223.255",
  ]) {
    assert.equal(egressProviderOf(ip), "anthropic", ip);
  }
  for (const ip of ["160.79.103.255", "160.79.112.0", "153.61.207.255", "153.61.224.0"]) {
    assert.equal(egressProviderOf(ip), null, ip);
  }
});

test("OpenAI's published ChatGPT connector ranges", () => {
  assert.equal(OPENAI_CHATGPT_EGRESS_RANGES.length, 289);
  for (const ip of ["9.129.0.1", "9.129.255.254", "52.6.94.121", "20.170.184.20"]) {
    assert.equal(egressProviderOf(ip), "openai", ip);
  }
  for (const ip of ["9.130.0.1", "52.6.94.120", "52.6.94.122"]) {
    assert.equal(egressProviderOf(ip), null, ip);
  }
});

test("anything else, or no address, is no platform", () => {
  for (const ip of [null, "", "unknown", "203.0.113.7", "127.0.0.1", "2001:db8::1", "160.79.104"]) {
    assert.equal(egressProviderOf(ip), null, String(ip));
  }
});
