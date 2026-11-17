import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, mock, test } from "node:test";

// tsx loads these packages as CommonJS, whose `export *` names ESM cannot see.
const require = createRequire(import.meta.url);
for (const name of [
  "@louez/types",
  "@louez/utils",
  "@louez/utils/sanitize-rich-text",
  "@louez/validations",
]) {
  const namedExports: Record<string, unknown> = require(name);
  mock.module(name, { namedExports });
}
mock.module("@louez/auth", { namedExports: { auth: {}, authInstance: { api: {} } } });

const { INBOX_ITEM_TYPES } = await import("../../contracts/inbox");
const { API_DOMAINS } = await import("../../platform/permissions");
const { INBOX_ITEM_DOMAINS, mayShow } = await import("../../services/inbox");
const { acknowledgesType, listedTypes } = await import("./inbox");

// The inbox opens to every domain an approval can belong to. Every other
// type of item keeps who lists it and who acknowledges it as before: the
// rules before approvals, written out here, against the new gates, for every
// key that holds one domain or two, at read or write.

type Domain = (typeof API_DOMAINS)[number];
type Level = "read" | "write";

/** Before approvals: the inbox opened to reservations, settings, integrations, billing or the team, read. */
const OPENED_BEFORE: readonly Domain[] = [
  "reservations",
  "settings",
  "integrations",
  "billing",
  "team",
];
/** Before approvals: acknowledging opened to reservations, payments, settings, integrations, billing or the team, written. */
const ACKNOWLEDGED_BEFORE: readonly Domain[] = [
  "reservations",
  "payments",
  "settings",
  "integrations",
  "billing",
  "team",
];

const EXISTING = INBOX_ITEM_TYPES.filter((type) => type !== "approval_waiting");

/** Every key of one or two domains, each at read or write. */
function profiles(): Array<Partial<Record<Domain, Level>>> {
  const levels: Level[] = ["read", "write"];
  const out: Array<Partial<Record<Domain, Level>>> = [{}];
  for (const [index, first] of API_DOMAINS.entries()) {
    for (const level of levels) {
      out.push({ [first]: level });
      for (const second of API_DOMAINS.slice(index + 1)) {
        for (const other of levels) out.push({ [first]: level, [second]: other });
      }
    }
  }
  return out;
}

describe("the inbox's gates, before and after approvals", () => {
  for (const profile of profiles()) {
    const label = JSON.stringify(profile);
    const reads = Object.fromEntries(
      API_DOMAINS.map((domain) => [domain, profile[domain] !== undefined]),
    );
    const writes = (domain: Domain) => profile[domain] === "write";

    test(`${label}: lists and acknowledges the same existing types as before`, () => {
      const openedBefore = OPENED_BEFORE.some((domain) => reads[domain]);
      const ackBefore = ACKNOWLEDGED_BEFORE.some(writes);
      const listed = listedTypes(reads);
      for (const type of EXISTING) {
        const listedBefore = openedBefore && mayShow(reads, type);
        assert.equal(listed.includes(type), listedBefore, `${type} listed`);
        const [first] = INBOX_ITEM_DOMAINS[type];
        const acknowledgedBefore =
          ackBefore && mayShow(reads, type) && (first ? writes(first) : true);
        assert.equal(
          acknowledgesType(type, reads, writes),
          acknowledgedBefore,
          `${type} acknowledged`,
        );
      }
      // An approval, to any caller: whose it is and its domain decide, in its source.
      assert.equal(listed.includes("approval_waiting"), true);
    });
  }
});
