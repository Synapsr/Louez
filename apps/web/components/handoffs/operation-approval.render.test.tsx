import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";

import type { ApprovalPage, ShownPreview } from "@louez/api/services/approval-page";

import messages from "@/messages/en.json";

import { OperationApproval } from "./operation-approval";
import { OperationApprovalDone, type EndedApprovalState } from "./operation-approval-done";

// tsx loads the shared UI package through CommonJS with the classic JSX runtime.
Object.assign(globalThis, { React });

// The page a person approves or refuses an agent's request on, and its
// result, rendered as the server renders them: what is shown first, what is
// at stake, what the form posts, and what a careless tap cannot do.

const NOW = new Date("2026-11-14T10:00:00.000Z");
const minutes = (count: number) => new Date(NOW.getTime() + count * 60_000);

const PREVIEW: ShownPreview = {
  summary: "Record a rental payment of 40.00 € (cash) on reservation #1042.",
  details: [
    { label: "Number", value: { kind: "text", text: "1042" } },
    { label: "Amount", value: { kind: "text", text: "40" } },
    { label: "Refunded", value: { kind: "no" } },
    { label: "Note", value: { kind: "none" } },
  ],
};

const approval = (overrides: Partial<ApprovalPage> = {}) =>
  ({
    id: "abcdefghijklmnopqrstu",
    state: "pending",
    revision: 2,
    binding: "e".repeat(64),
    store: { id: "store_000000000000001", name: "Roscoff Voile" },
    agent: { kind: "api_key", name: "Store agent" },
    preview: PREVIEW,
    consequences: ["money"],
    deliberate: true,
    computedAt: minutes(-3),
    expiresAt: minutes(23 * 60),
    now: NOW,
    completedAt: null,
    decision: null,
    ...overrides,
  }) as ApprovalPage & { preview: ShownPreview; binding: string };

const wrap = (node: React.ReactNode) =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale="en" timeZone="Europe/Paris" now={NOW} messages={messages}>
      {node}
    </NextIntlClientProvider>,
  );

const renderPage = (overrides: Partial<ApprovalPage> = {}, note: string | null = null) =>
  wrap(
    <OperationApproval
      action="/handoffs/abcdefghijklmnopqrstu/decide"
      approval={approval(overrides)}
      email="olga@roscoff.test"
      note={note}
    />,
  );

/** The opening tags named `tag` in `html`, each as its attributes. */
const tags = (html: string, tag: string) =>
  [...html.matchAll(new RegExp(`<${tag}\\b([^>]*)>`, "g"))].map((match) =>
    Object.fromEntries(
      [...(match[1] ?? "").matchAll(/([\w-]+)="([^"]*)"/g)].map((pair) => [pair[1], pair[2]]),
    ),
  );

const textOf = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

describe("the approval's page", () => {
  test("what Louez will do comes first, then what is at stake, who asks, the details and the time", () => {
    const html = renderPage();
    const text = textOf(html);
    assert.match(text, /Approve a payment action\?/);
    assert.match(
      text,
      /Your AI assistant asks for your approval in “Roscoff Voile”\. It acts for your account \(olga@roscoff\.test\): nothing happens unless you approve\./,
    );
    // Each part found after the one before it.
    let from = 0;
    for (const part of [
      "What Louez will do if you approve",
      "Record a rental payment of 40.00 € (cash) on reservation #1042.",
      "Money",
      "Asked by",
      "API key “Store agent”",
      "What Louez checked",
      "Louez worked this out 3 minutes ago, from your store’s records.",
      "If you don’t answer, the request lapses in 23 hours.",
      "Only this summary from Louez counts, whatever your assistant said in the chat.",
      "A word for your assistant (optional)",
      "I have read what Louez will do",
      "Refuse",
      "Approve",
    ]) {
      const at = text.indexOf(part, from);
      assert.ok(at >= from, `shows ${part}, after what comes before it`);
      from = at + part.length;
    }
    assert.match(text, /Number 1042/);
    assert.match(text, /Refunded No/);
    assert.match(text, /Note Not set/);
  });

  test("the form posts the answer with the revision and the binding shown", () => {
    const html = renderPage();
    const [form] = tags(html, "form");
    assert.equal(form?.method, "post");
    assert.equal(form?.action, "/handoffs/abcdefghijklmnopqrstu/decide");
    const hidden = tags(html, "input").filter((input) => input.type === "hidden");
    assert.deepEqual(
      hidden.map((input) => [input.name, input.value]),
      [
        ["revision", "2"],
        ["shown", "e".repeat(64)],
      ],
    );
    assert.equal(tags(html, "textarea")[0]?.maxLength, "500");
    // Nothing but the two buttons posts an answer; the box to tick posts nothing.
    const named = tags(html, "input").filter((input) => input.name);
    assert.deepEqual(
      named.map((input) => input.name),
      ["revision", "shown"],
    );
  });

  test("money, a stock override or an access removed waits for the box: a tap on Approve alone does nothing", () => {
    for (const consequences of [["money"], ["stock_override"], ["access_removed"]] as const) {
      const html = renderPage({ consequences: [...consequences], deliberate: true });
      const buttons = tags(html, "button").filter((button) => button.name === "decision");
      assert.deepEqual(
        buttons.map((button) => [button.value, "disabled" in button]),
        [
          ["refuse", false],
          ["approve", true],
        ],
        consequences[0],
      );
      assert.match(textOf(html), /I have read what Louez will do/);
    }
  });

  test("a plain change asks for no box, names no stake, and Approve is ready", () => {
    const html = renderPage({ consequences: ["change"], deliberate: false });
    const text = textOf(html);
    assert.match(text, /Approve this change\?/);
    assert.doesNotMatch(text, /I have read what Louez will do/);
    assert.doesNotMatch(html, /data-slot="alert"/);
    const approve = tags(html, "button").find((button) => button.value === "approve");
    assert.ok(approve && !("disabled" in approve));
  });

  test("the gravest consequence names the page; each is shown, what cannot be put back as a warning", () => {
    const html = renderPage({ consequences: ["customer_message", "stock_override"] });
    const text = textOf(html);
    assert.match(text, /Approve booking over your stock\?/);
    assert.ok(text.indexOf("Stock") < text.indexOf("Message"));
    const alerts = tags(html, "div").filter((div) => div["data-slot"] === "alert");
    assert.equal(alerts.length, 2);
    assert.match(alerts[0]?.class ?? "", /border-warning/);
    assert.match(alerts[1]?.class ?? "", /border-info/);
    // Shown as notes, not announced as errors.
    assert.ok(alerts.every((alert) => alert.role === "note"));
  });

  test("the preview's text stays text: markup is escaped, each detail value is isolated", () => {
    const html = renderPage({
      preview: {
        summary: "Pay <b>Ann</b> [now](https://evil.test)\nthen stop",
        details: [{ label: "Customer <i>", value: { kind: "text", text: "שרה <img src=x>" } }],
      },
    });
    assert.match(html, /Pay &lt;b&gt;Ann&lt;\/b&gt; \[now\]\(https:\/\/evil\.test\)\nthen stop/);
    assert.doesNotMatch(html, /<b>Ann/);
    assert.doesNotMatch(html, /<img src=x>/);
    assert.doesNotMatch(html, /href="https:\/\/evil/);
    assert.match(html, /Customer &lt;i&gt;/);
    assert.match(html, /<bdi[^>]*>שרה &lt;img src=x&gt;<\/bdi>/);
    // A long word breaks on a phone rather than widening the page.
    assert.match(html, /<p class="[^"]*wrap-anywhere[^"]*">Pay/);
  });

  test("nested details are shown as nested lists", () => {
    const html = renderPage({
      preview: {
        summary: "Confirm it.",
        details: [
          {
            label: "Lines",
            value: {
              kind: "list",
              entries: [{ label: "1", value: { kind: "text", text: "Kayak, 2 asked, 1 free" } }],
            },
          },
          { label: "Empty", value: { kind: "list", entries: [] } },
        ],
      },
    });
    assert.equal(tags(html, "dl").length, 2);
    assert.match(textOf(html), /Lines 1 Kayak, 2 asked, 1 free/);
    assert.match(textOf(html), /Empty Not set/);
  });

  test("an assistant connected over OAuth is named as the consent page names it", () => {
    const html = renderPage({
      agent: {
        kind: "oauth",
        name: "Claude",
        client: {
          clientId: "https://claude.ai/oauth/client.json",
          name: "Claude",
          declaredBy: "claude.ai",
          verified: true,
          iconUrl: null,
          redirectHost: null,
          loopbackRedirect: false,
          destination: null,
        },
      },
    });
    const text = textOf(html);
    assert.match(text, /Claude/);
    assert.match(text, /Name declared by claude\.ai/);
    assert.match(text, /Verified/);
    const unknown = textOf(renderPage({ agent: { kind: "oauth", name: null, client: null } }));
    assert.match(unknown, /An AI assistant/);
    const unnamedKey = textOf(renderPage({ agent: { kind: "api_key", name: null } }));
    assert.match(unnamedKey, /An API key/);
  });

  test("a request that changed while the page was open says so above the request as it is now", () => {
    const html = renderPage({}, "This request changed while you were reading");
    assert.match(html, /role="alert"[^>]*>This request changed while you were reading</);
  });
});

describe("the approval's result", () => {
  const renderDone = (state: EndedApprovalState, overrides: Partial<ApprovalPage> = {}) =>
    textOf(wrap(<OperationApprovalDone approval={approval({ state, ...overrides })} state={state} />));

  test("each state says where the request stands and what, if anything, is left to do", () => {
    const expected: Record<EndedApprovalState, RegExp> = {
      approved: /Approved Your assistant can now carry it out\. If it doesn’t, your approval lapses in 59 minutes and nothing is done\./,
      completed: /Done Your assistant carried it out 5 minutes ago\./,
      approved_expired: /Approved, but never carried out .*nothing was done\. If it still needs to, it will ask you again\./,
      refused: /Refused Nothing was done\./,
      state_changed: /Not carried out: your store changed .*Louez did nothing\. If your assistant still needs this, it will ask again/,
      approver_not_allowed: /Not carried out: your role changed .*nothing was done\./,
      connection_revoked: /Ended: the assistant was disconnected .*can no longer be answered or carried out\. Nothing was done\./,
      expired: /This request lapsed Nobody answered within a day, so nothing was done\./,
      ended: /This request ended .*nothing was done\./,
    };
    for (const [state, sentence] of Object.entries(expected) as Array<[EndedApprovalState, RegExp]>) {
      const text = renderDone(state, {
        expiresAt: minutes(59),
        completedAt: minutes(-5),
      });
      assert.match(text, sentence, state);
      // The request it was about follows, with its store.
      assert.match(text, /The request Roscoff Voile Record a rental payment of 40\.00 €/, state);
    }
  });

  test("a refusal shows the person's own words, as text", () => {
    const html = wrap(
      <OperationApprovalDone
        approval={approval({
          state: "refused",
          decision: { outcome: "refused", at: minutes(-1), reason: "Pas en <b>espèces</b>" },
        })}
        state="refused"
      />,
    );
    assert.match(textOf(html), /Your words Pas en &lt;b&gt;espèces&lt;\/b&gt;/);
    assert.doesNotMatch(renderDone("state_changed"), /Your words/);
    const approvedWithWords = renderDone("approved", {
      decision: { outcome: "approved", at: minutes(-1), reason: "Oui, en espèces" },
    });
    assert.match(approvedWithWords, /Your words Oui, en espèces/);
  });

  test("a request whose preview cannot be read shows no recap", () => {
    assert.doesNotMatch(renderDone("expired", { preview: null }), /The request/);
  });
});

describe("the texts", () => {
  const directory = join(process.cwd(), "messages");
  const keys = (value: unknown, prefix = ""): string[] =>
    value && typeof value === "object"
      ? Object.entries(value).flatMap(([key, entry]) => keys(entry, `${prefix}.${key}`))
      : [prefix];
  const approvalTexts = (file: string) =>
    (JSON.parse(readFileSync(join(directory, file), "utf8")) as {
      handoff: { operation_approval: unknown };
    }).handoff.operation_approval;

  test("every locale of the hand-off pages has every text of the approval's pages", () => {
    const english = keys(approvalTexts("en.json")).sort();
    const files = readdirSync(directory).filter((file) => file.endsWith(".json"));
    assert.ok(files.length >= 13);
    for (const file of files) {
      assert.deepEqual(keys(approvalTexts(file)).sort(), english, file);
    }
  });

  test("they speak to a store owner: no developer's word", () => {
    const words = JSON.stringify(approvalTexts("en.json")).toLowerCase();
    for (const word of ["binding", "revision", "procedure", "handoff", "api_", "token"]) {
      assert.ok(!words.includes(word), word);
    }
  });
});
