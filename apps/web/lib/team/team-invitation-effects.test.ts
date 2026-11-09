import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import { before, beforeEach, describe, test } from "node:test";

import type { EffectSendContext } from "@louez/api/platform/effects";

import type { TeamInvitationEffectDeps } from "./team-invitation-effects";

interface ResolveContext {
  parentURL?: string;
}
type NextResolve = (specifier: string, context: ResolveContext) => { url: string };

// The sender's modules import "server-only", which throws outside Next.
const registerHooks = Reflect.get(nodeModule, "registerHooks");
if (typeof registerHooks !== "function") {
  throw new Error("This test requires node:module registerHooks");
}
registerHooks({
  resolve(specifier: string, context: ResolveContext, nextResolve: NextResolve) {
    if (specifier === "server-only") return { shortCircuit: true, url: "node:module" };
    return nextResolve(specifier, context);
  },
});

// The sender of a team invitation's e-mail, with fakes: it reads the address
// and the token when it sends, checks its claim first, and sends nothing for
// an invitation no longer pending or an instance without e-mail.

describe("team invitation e-mail sender", () => {
  let sent: Array<Parameters<TeamInvitationEffectDeps["sendTeamInvitationEmail"]>[0]> = [];
  let claims = 0;
  let emailConfigured = true;
  let pending: { email: string; token: string } | null = null;

  const context: EffectSendContext = {
    signal: new AbortController().signal,
    throwIfAborted: () => {},
    assertClaim: async () => {
      claims += 1;
    },
  };
  const payload = {
    invitationId: "inv_1",
    store: { name: "Brest Surf", logoUrl: null, country: "FR" },
    inviterName: "Olivia Owner",
  };

  let senders: ReturnType<
    typeof import("./team-invitation-effects").createTeamInvitationEffectSenders
  >;

  before(async () => {
    const { createTeamInvitationEffectSenders } = await import("./team-invitation-effects");
    senders = createTeamInvitationEffectSenders({
      isEmailConfigured: () => emailConfigured,
      readPendingInvitation: async (id) => {
        assert.equal(id, "inv_1");
        return pending;
      },
      sendTeamInvitationEmail: async (input) => {
        assert.equal(claims, 1, "the claim is checked before sending");
        sent.push(input);
        return { success: true, messageId: "m1" };
      },
    });
  });

  beforeEach(() => {
    sent = [];
    claims = 0;
    emailConfigured = true;
    pending = { email: "new@tm.test", token: "the-current-token" };
  });

  test("sends the invitation's current link, in the store's language", async () => {
    assert.equal(await senders["team.invitationEmail"](payload, context), undefined);
    assert.equal(sent.length, 1);
    assert.equal(sent[0]?.to, "new@tm.test");
    assert.equal(sent[0]?.storeName, "Brest Surf");
    assert.equal(sent[0]?.inviterName, "Olivia Owner");
    assert.equal(sent[0]?.locale, "fr");
    assert.match(sent[0]?.invitationUrl ?? "", /\/invitation\/the-current-token$/);
  });

  test("an invitation no longer pending, or no e-mail on this instance, sends nothing", async () => {
    pending = null;
    assert.deepEqual(await senders["team.invitationEmail"](payload, context), {
      skipped: "invitation_not_pending",
    });
    emailConfigured = false;
    assert.deepEqual(await senders["team.invitationEmail"](payload, context), {
      skipped: "email_not_configured",
    });
    assert.equal(sent.length, 0);
    assert.equal(claims, 0);
  });
});
