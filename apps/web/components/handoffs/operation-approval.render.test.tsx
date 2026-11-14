import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";

import type { ApprovalPage, ShownPreview } from "@louez/api/services/approval-page";
import { approvalIsReadable, shownPreview } from "@louez/api/services/approval-preview";

import messages from "@/messages/en.json";

import { sampleApprovals } from "../../scripts/seed/approvals-samples";
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
  truncated: false,
  details: [
    { label: "Number", value: { kind: "text", text: "1042" } },
    { label: "Amount", value: { kind: "number", value: 40 } },
    { label: "Refunded", value: { kind: "no" } },
  ],
};

const approval = (overrides: Partial<ApprovalPage> = {}) =>
  ({
    id: "abcdefghijklmnopqrstu",
    state: "pending",
    revision: 2,
    binding: "e".repeat(64),
    store: { id: "store_000000000000001", name: "Roscoff Voile", timeZone: "Europe/Paris" },
    agent: { kind: "api_key", name: "Store agent", shownName: "Store agent" },
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

const DISCLOSURE = /<details\b([^>]*)>([\s\S]*?)<\/details>/g;
/** The page as a person sees it before opening anything: every disclosure's body left out. */
const visible = (html: string) =>
  textOf(html.replace(DISCLOSURE, (_whole, attributes: string, body: string) => {
    const summary = /<summary\b[^>]*>([\s\S]*?)<\/summary>/.exec(body)?.[1] ?? "";
    return /\bopen\b/.test(attributes) ? body : `<summary>${summary}</summary>`;
  }));
/** Each disclosure: whether it is open, what its summary says, and its body. */
const disclosures = (html: string) =>
  [...html.matchAll(DISCLOSURE)].map((match) => ({
    open: /\bopen\b/.test(match[1] ?? ""),
    label: textOf(/<summary\b[^>]*>([\s\S]*?)<\/summary>/.exec(match[2] ?? "")?.[1] ?? "").trim(),
    body: match[2] ?? "",
  }));

/** The markup of what Louez checked: from its first list to its last. */
const checkedList = (html: string) => {
  const start = html.indexOf("<dl");
  return start < 0 ? "" : html.slice(start, html.lastIndexOf("</dl>") + 5);
};
/** Classes that size a column, box each cell, or let a word break at any letter. */
const NARROW =
  /<table|grid-cols|basis-|(?<![-\w])w-(?:\d|\[)|min-w-\[|max-w-\[|divide-y|wrap-anywhere|break-all/;

/** An attribute of a tag, whatever its case (React writes `formNoValidate`). */
const has = (attributes: Record<string, string>, name: string) =>
  Object.keys(attributes).some((key) => key.toLowerCase() === name);

describe("the approval's page", () => {
  test("the screen holds the title, where and who asks, the sentence, the short safety line, the stake, the box and the two buttons, and nothing else", () => {
    const shown = visible(renderPage());
    let from = 0;
    for (const part of [
      "Approve a payment?",
      "Roscoff Voile · asked by “Store agent”",
      "Record a rental payment of 40.00 € (cash) on reservation #1042.",
      "Only Louez’s summary counts.",
      "Can’t be undone: money.",
      "Details",
      "Add a note for your assistant",
      "I’ve read what Louez will do",
      "Refuse",
      "Approve",
    ]) {
      const at = shown.indexOf(part, from);
      assert.ok(at >= from, `shows ${part}, after what comes before it`);
      from = at + part.length;
    }
    // Context is on request only.
    for (const hidden of [
      "Asked by",
      "API key “Store agent”",
      "olga@roscoff.test",
      "in “Roscoff Voile”",
      "What Louez checked",
      "Number",
      "3 minutes ago",
      "in 23 hours",
      "whatever your assistant said in the chat",
      "Your note (optional)",
      "Lapses",
    ]) {
      assert.ok(!shown.includes(hidden), `${hidden} is not on the screen`);
    }
  });

  test("two disclosures, closed: the details (who asks, for whom, what Louez checked, when, the full safety sentence), and the note", () => {
    const html = renderPage();
    const [details, note, ...more] = disclosures(html);
    assert.equal(more.length, 0);
    assert.ok(details && note);
    assert.equal(details.open, false);
    assert.equal(note.open, false);
    assert.equal(details.label, "Details");
    assert.equal(note.label, "Add a note for your assistant");
    const inside = textOf(details.body);
    for (const part of [
      "Asked by",
      "API key “Store agent”",
      "For your account olga@roscoff.test, in “Roscoff Voile”.",
      "What Louez checked",
      "Number 1042",
      "Amount 40",
      "Refunded No",
      "Louez worked this out 3 minutes ago, from your store’s records.",
      "If you don’t answer, the request lapses in 23 hours.",
      "Only this summary from Louez counts, whatever your assistant said in the chat. If they don’t match, refuse.",
    ]) {
      assert.ok(inside.includes(part), `the details hold ${part}`);
    }
    assert.match(textOf(note.body), /Your note \(optional\)/);
  });

  test("the note is a field of the form inside its closed disclosure, posted whether it was opened or not", () => {
    const html = renderPage();
    const form = /<form\b[^>]*>([\s\S]*)<\/form>/.exec(html)?.[1] ?? "";
    const [, note] = disclosures(form);
    assert.ok(note && !note.open);
    const [reason] = tags(note.body, "textarea");
    assert.equal(reason?.name, "reason");
    assert.equal(reason?.maxLength, "500");
    // Nothing keeps it from being posted: not disabled, and no form of its own.
    assert.ok(reason && !has(reason, "disabled") && !has(reason, "form"));
  });

  test("the lapse shows on the screen only when less than an hour is left", () => {
    assert.match(visible(renderPage({ expiresAt: minutes(40) })), /Lapses in 40 minutes\./);
    assert.match(visible(renderPage({ expiresAt: minutes(60) })), /Lapses in 1 hour\./);
    assert.doesNotMatch(visible(renderPage({ expiresAt: minutes(61) })), /Lapses/);
    assert.doesNotMatch(visible(renderPage()), /Lapses/);
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
    // Besides the two buttons and the note, only the box posts: "yes" once ticked.
    const named = tags(html, "input").filter((input) => input.name);
    assert.deepEqual(
      named.map((input) => input.name),
      ["revision", "shown", "acknowledged"],
    );
    const [box] = tags(html, "input").filter((input) => input.type === "checkbox");
    assert.equal(box?.value, "yes");
  });

  test("money, a stock override or an access removed waits for the box, in the browser itself: a required checkbox, Refuse skips it", () => {
    for (const consequences of [["money"], ["stock_override"], ["access_removed"]] as const) {
      const html = renderPage({ consequences: [...consequences], deliberate: true });
      const [box] = tags(html, "input").filter((input) => input.type === "checkbox");
      assert.ok(box && has(box, "required"), consequences[0]);
      assert.equal(box.name, "acknowledged");
      const buttons = tags(html, "button").filter((button) => button.name === "decision");
      assert.deepEqual(
        buttons.map((button) => [button.value, has(button, "formnovalidate"), has(button, "disabled")]),
        [
          ["refuse", true, false],
          ["approve", false, false],
        ],
        consequences[0],
      );
      // Approve only looks dimmed while the form is invalid: nothing blocks a ticked form.
      assert.match(buttons[1]?.class ?? "", /group-has-\[:invalid\]:opacity-60/);
      assert.match(tags(html, "form")[0]?.class ?? "", /\bgroup\b/);
      assert.match(visible(html), /I’ve read what Louez will do/);
    }
  });

  test("a plain change asks for no box, names no stake, and Approve is ready", () => {
    const html = renderPage({ consequences: ["change"], deliberate: false });
    const shown = visible(html);
    assert.match(shown, /Approve this change\?/);
    assert.doesNotMatch(shown, /I’ve read what Louez will do|Can’t be undone/);
    assert.doesNotMatch(html, /data-slot="alert"/);
    assert.equal(tags(html, "input").filter((input) => input.type === "checkbox").length, 0);
    const buttons = tags(html, "button");
    assert.ok(buttons.every((button) => !has(button, "disabled") && !has(button, "formnovalidate")));
  });

  test("nothing Louez knows of what it does: asked as a request, with the box, and no stake named", () => {
    const shown = visible(renderPage({ consequences: [], deliberate: true }));
    assert.match(shown, /Approve this request\?/);
    assert.match(shown, /I’ve read what Louez will do/);
    assert.doesNotMatch(shown, /Can’t be undone/);
  });

  test("the gravest consequence names the page; the stake is one line, as a warning, naming each in order", () => {
    const html = renderPage({ consequences: ["customer_message", "stock_override"] });
    const shown = visible(html);
    assert.match(shown, /Approve booking past your stock\?/);
    assert.match(shown, /Can’t be undone: stock past its limit and a message to a customer\./);
    const alerts = tags(html, "div").filter((div) => div["data-slot"] === "alert");
    assert.equal(alerts.length, 1);
    assert.match(alerts[0]?.class ?? "", /border-warning/);
    // Shown as a note, not announced as an error.
    assert.equal(alerts[0]?.role, "note");
  });

  test("the preview's text stays text: one paragraph, markup escaped, each detail value isolated on one line", () => {
    const html = renderPage({
      preview: {
        summary: "Pay <b>Ann</b> [now](https://evil.test) then stop",
        truncated: false,
        details: [{ label: "Customer <i>", value: { kind: "text", text: "שרה <img src=x>" } }],
      },
    });
    assert.match(html, /<p class="[^"]*">Pay &lt;b&gt;Ann&lt;\/b&gt; \[now\]\(https:\/\/evil\.test\) then stop<\/p>/);
    // Nothing on the page keeps a line break the text holds.
    assert.doesNotMatch(html, /whitespace-pre|<br/);
    assert.doesNotMatch(html, /<b>Ann/);
    assert.doesNotMatch(html, /<img src=x>/);
    assert.doesNotMatch(html, /href="https:\/\/evil/);
    assert.match(html, /Customer &lt;i&gt;/);
    assert.match(html, /<bdi[^>]*>שרה &lt;img src=x&gt;<\/bdi>/);
    // A long word breaks on a phone rather than widening the page, as a last resort.
    assert.match(html, /<p class="[^"]*wrap-break-word[^"]*">Pay/);
  });

  test("the summary's box and each value's box clip what they would draw past themselves", () => {
    const html = renderPage();
    const [summary] = tags(html, "p").filter((p) => (p.class ?? "").includes("text-base"));
    assert.match(summary?.class ?? "", /\boverflow-hidden\b/);
    const values = tags(html, "dd").filter((dd) => !(dd.class ?? "").includes("border-l"));
    assert.ok(values.length >= 3);
    assert.ok(values.every((dd) => /\boverflow-hidden\b/.test(dd.class ?? "")));
  });

  test("the details are a flat list: groups under a heading, no table, no column, values written as a person writes them", () => {
    const html = renderPage({
      preview: {
        summary: "Confirm it.",
        truncated: false,
        details: [
          {
            label: "Reservation",
            value: {
              kind: "group",
              entries: [
                { label: "Number", value: { kind: "text", text: "1042" } },
                { label: "Start date", value: { kind: "date", iso: "2026-11-21T09:00:00.000Z", dateOnly: false } },
                { label: "End date", value: { kind: "date", iso: "2026-11-23", dateOnly: true } },
                { label: "Total amount", value: { kind: "money", amount: 180, currency: "EUR" } },
              ],
            },
          },
          {
            label: "Shortfalls",
            value: {
              kind: "group",
              entries: [
                {
                  label: "Kayak biplace",
                  value: {
                    kind: "group",
                    entries: [
                      { label: "Requested", value: { kind: "number", value: 2 } },
                      { label: "Available", value: { kind: "number", value: 1 } },
                    ],
                  },
                },
              ],
            },
          },
          { label: "Reduces availability", value: { kind: "yes" } },
          { label: "Buffer", value: { kind: "number", value: 1200 } },
        ],
      },
    });
    const details = textOf(disclosures(html)[0]?.body ?? "");
    // Paris time: 09:00 UTC is 10:00; a date alone is that day, whatever the zone.
    assert.match(details, /Reservation Number 1042 Start date Nov 21, 2026, 10:00 AM End date Nov 23, 2026 Total amount €180\.00/);
    assert.match(details, /Shortfalls Kayak biplace Requested 2 Available 1/);
    assert.match(details, /Reduces availability Yes/);
    assert.match(details, /Buffer 1,200/);
    assert.doesNotMatch(details, /T09:00|\.000Z|2026-11/);
    // No table, no fixed column, no box around each cell.
    assert.ok(checkedList(html).length > 0);
    assert.doesNotMatch(checkedList(html), NARROW);
    // Groups are set in by a rule on one side, never boxed.
    // Reservation, Shortfalls, and the named item Kayak biplace.
    const groups = tags(html, "dd").filter((dd) => (dd.class ?? "").includes("border-l"));
    assert.equal(groups.length, 3);
  });

  test("the three sample requests' details render flat, with no identifier and no raw date", () => {
    const samples = sampleApprovals({
      storeName: "Vélo Liberté",
      currency: "EUR",
      reservation: {
        id: "res_7Hk2pQ9xLmN4vB1cD3eF",
        number: "1042",
        startDate: "2026-11-21T09:00:00.000Z",
        endDate: "2026-11-23T18:00:00.000Z",
        totalAmount: "180.00",
        customer: "Camille Martin",
        email: "camille.martin@example.com",
      },
    });
    assert.equal(samples.length, 3);
    for (const sample of samples) {
      assert.ok(approvalIsReadable(sample.payload), sample.label);
      const preview = shownPreview(sample.payload.preview);
      assert.ok(preview);
      const html = renderPage({ preview, consequences: [...sample.payload.consequences] as never });
      const details = textOf(disclosures(html)[0]?.body ?? "");
      assert.doesNotMatch(details, /res_7Hk2|sample_membership|\bId\b|T\d{2}:\d{2}:\d{2}|\.000Z/, sample.label);
      assert.ok(checkedList(html).length > 0, sample.label);
      assert.doesNotMatch(checkedList(html), NARROW, sample.label);
    }
    const [payment, booking, removal] = samples.map((sample) =>
      textOf(disclosures(renderPage({ preview: shownPreview(sample.payload.preview) ?? PREVIEW }))[0]?.body ?? ""),
    );
    assert.match(payment ?? "", /What Louez checked .*Number 1042/);
    assert.match(payment ?? "", /Amount 120/);
    assert.match(booking ?? "", /Reservation .*Number 1042/);
    assert.match(booking ?? "", /Start date Nov 21, 2026, 10:00 AM/);
    assert.match(booking ?? "", /Total amount €180\.00/);
    assert.match(booking ?? "", /Kayak biplace Requested 2 Available 1/);
    assert.match(booking ?? "", /Customer .*Name Camille Martin .*Email camille\.martin@example\.com/);
    assert.match(removal ?? "", /Member .*Name Lucas Bernard .*Email lucas\.bernard@example\.com/);
  });

  test("an assistant connected over OAuth is named, in the details, as the consent page names it", () => {
    const html = renderPage({
      agent: {
        kind: "oauth",
        name: "Claude",
        shownName: "Claude",
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
    const [details] = disclosures(html);
    const inside = textOf(details?.body ?? "");
    assert.match(inside, /Claude/);
    assert.match(inside, /Name declared by claude\.ai/);
    assert.match(inside, /Verified/);
    // On the screen, its name alone, under the title.
    assert.match(visible(html), /Roscoff Voile · asked by “Claude”/);
    assert.doesNotMatch(visible(html), /Name declared|Verified/);
    const unknown = renderPage({ agent: { kind: "oauth", name: null, client: null, shownName: null } });
    assert.match(textOf(unknown), /An AI assistant/);
    assert.match(visible(unknown), /Roscoff Voile · asked by an AI assistant/);
    const unnamedKey = renderPage({ agent: { kind: "api_key", name: null, shownName: null } });
    assert.match(textOf(unnamedKey), /An API key/);
    assert.match(visible(unnamedKey), /Roscoff Voile · asked by an API key/);
  });

  test("a request that changed while the page was open says so on the screen", () => {
    const html = renderPage({}, "This request changed while you were reading");
    assert.match(html, /role="alert"[^>]*>This request changed while you were reading</);
    assert.match(visible(html), /This request changed while you were reading/);
  });
});

describe("the approval's result", () => {
  const renderDoneHtml = (state: EndedApprovalState, overrides: Partial<ApprovalPage> = {}) =>
    wrap(<OperationApprovalDone approval={approval({ state, ...overrides })} state={state} />);
  const renderDone = (state: EndedApprovalState, overrides: Partial<ApprovalPage> = {}) =>
    textOf(renderDoneHtml(state, overrides));

  test("the screen says the outcome in one line; what it means is in the closed details", () => {
    const expected: Record<EndedApprovalState, [string, RegExp]> = {
      approved: ["Approved", /Your assistant can now carry it out\. If it doesn’t, your approval lapses in 59 minutes and nothing is done\./],
      completed: ["Done", /Your assistant carried it out 5 minutes ago\./],
      approved_expired: ["Your approval lapsed", /Your approval lapsed after an hour without Louez recording that it was carried out\. If your assistant carried it out at the very last moment, this page shows it once reloaded; otherwise nothing is done\./],
      refused: ["Refused", /Nothing was done\./],
      state_changed: ["Not carried out: the request no longer matched", /What your assistant asked, or your store, no longer matched what you approved, so nothing was done\. It will ask again if it still needs it\./],
      approver_not_allowed: ["Not carried out: your role changed", /nothing was done\./],
      connection_revoked: ["Ended: the assistant was disconnected", /The assistant’s connection to Louez was removed, so this request can no longer be answered or carried out\. If your assistant carried it out at the very last moment before that, this page shows it once reloaded; otherwise nothing is done\./],
      expired: ["This request lapsed", /Nobody answered within a day, so the request lapsed\. If an answer was being recorded at that very moment, this page shows it once reloaded; otherwise nothing is done/],
      ended: ["This request ended", /nothing was done\./],
    };
    for (const [state, [title, meaning]] of Object.entries(expected) as Array<
      [EndedApprovalState, [string, RegExp]]
    >) {
      const html = renderDoneHtml(state, { expiresAt: minutes(59), completedAt: minutes(-5) });
      assert.equal(visible(html).trim(), `${title} Details`, state);
      const [details, ...more] = disclosures(html);
      assert.equal(more.length, 0, state);
      assert.ok(details && !details.open, state);
      const inside = textOf(details.body);
      assert.match(inside, meaning, state);
      // The request it was about, with its store.
      assert.match(inside, /The request Roscoff Voile Record a rental payment of 40\.00 €/, state);
    }
  });

  test("the person's own words, in the details, as text", () => {
    const html = renderDoneHtml("refused", {
      decision: { outcome: "refused", at: minutes(-1), reason: "Pas en <b>espèces</b>" },
    });
    assert.match(textOf(disclosures(html)[0]?.body ?? ""), /Your words Pas en &lt;b&gt;espèces&lt;\/b&gt;/);
    assert.doesNotMatch(visible(html), /Your words/);
    assert.doesNotMatch(renderDone("state_changed"), /Your words/);
    const approvedWithWords = renderDone("approved", {
      decision: { outcome: "approved", at: minutes(-1), reason: "Oui, en espèces" },
    });
    assert.match(approvedWithWords, /Your words Oui, en espèces/);
  });

  test("a summary too long to show whole says so under it", () => {
    const text = renderDone("expired", {
      preview: { summary: "Record a payment…", truncated: true, details: [] },
    });
    assert.match(text, /Record a payment… The summary was too long to show whole\./);
    assert.doesNotMatch(renderDone("expired"), /too long/);
  });

  test("a request whose preview cannot be read shows no recap", () => {
    assert.doesNotMatch(renderDone("expired", { preview: null }), /The request/);
  });
});

describe("an approval without a display", () => {
  // Any action but the six pull request 7 switches, and every older row: the
  // page and its result exactly as they were, to the byte.
  const digest = (html: string) => createHash("sha256").update(html).digest("hex");
  const PAGES: Array<[string, () => string, string]> = [
    ["the page", () => renderPage(), "db36b5ad9262a249b3ddb6b23f7fc6e0d3934e1f3711556bdb18d04f3eda113a"],
    ["the page with a note", () => renderPage({}, "This request changed while you were reading"), "41ebb32f5dc8cff78d285cf9ba678b40d0934db5d932e8d2da62f20fb5e5626b"],
    [
      "the result",
      () =>
        wrap(
          <OperationApprovalDone
            approval={approval({ state: "refused", decision: { outcome: "refused", at: minutes(-1), reason: "Non" } })}
            state="refused"
          />,
        ),
      "a9c927d8c680a3ea22e8d3cd5a761cd3b2170b43ca2812a388f5cff00f9bb85c",
    ],
  ];
  for (const [name, render, expected] of PAGES) {
    test(`${name} is as it was`, () => {
      const html = render();
      assert.equal(digest(html), expected);
    });
  }
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
