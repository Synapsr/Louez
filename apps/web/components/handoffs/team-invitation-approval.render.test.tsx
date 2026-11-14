import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";

import messages from "@/messages/en.json";

import { TeamInvitationApproval } from "./team-invitation-approval";

// tsx loads the shared UI package through CommonJS with the classic JSX runtime.
Object.assign(globalThis, { React });

// The form an owner answers an agent's invitation with: what it posts, and
// what it says. It must stay as it is when the decision form is shared.

const render = (props: Partial<Parameters<typeof TeamInvitationApproval>[0]> = {}) =>
  renderToStaticMarkup(
    <NextIntlClientProvider locale="en" timeZone="Europe/Paris" messages={messages}>
      <TeamInvitationApproval
        action="/handoffs/abcdefghijklmnopqrstu/decide"
        revision={3}
        shown={"d".repeat(64)}
        store="Roscoff Voile"
        invitation={{ email: "new@person.test", role: "member", joinsAtOnce: false }}
        note={null}
        {...props}
      />
    </NextIntlClientProvider>,
  );

/** The opening tags named `tag` in `html`, each as its attributes. */
const tags = (html: string, tag: string) =>
  [...html.matchAll(new RegExp(`<${tag}\\b([^>]*)>`, "g"))].map((match) =>
    Object.fromEntries(
      [...(match[1] ?? "").matchAll(/([\w-]+)="([^"]*)"/g)].map((pair) => [pair[1], pair[2]]),
    ),
  );

test("the form posts the answer, the revision and the digest shown to the decide route", () => {
  const html = render();
  const [form] = tags(html, "form");
  assert.equal(form?.method, "post");
  assert.equal(form?.action, "/handoffs/abcdefghijklmnopqrstu/decide");
  const hidden = tags(html, "input").filter((input) => input.type === "hidden");
  assert.deepEqual(
    hidden.map((input) => [input.name, input.value]),
    [
      ["revision", "3"],
      ["shown", "d".repeat(64)],
    ],
  );
  const [reason] = tags(html, "textarea");
  assert.equal(reason?.name, "reason");
  assert.equal(reason?.maxLength, "500");
  // Refuse first, then approve: the two answers, and nothing else posts one.
  const buttons = tags(html, "button");
  assert.deepEqual(
    buttons.map((button) => [button.type, button.name, button.value]),
    [
      ["submit", "decision", "refuse"],
      ["submit", "decision", "approve"],
    ],
  );
  assert.ok(buttons.every((button) => !("disabled" in button)));
  // No box to tick, so nothing for the browser to validate, and no answer skips it.
  assert.equal(tags(html, "input").filter((input) => input.type === "checkbox").length, 0);
  assert.ok(buttons.every((button) => !Object.keys(button).some((key) => /novalidate/i.test(key))));
  assert.doesNotMatch(html, /required/);
  assert.match(html, />Decline<\/span><\/button>/);
  assert.match(html, />Approve the invitation<\/span><\/button>/);
});

test("it says who joins, as what, how, and what a member sees", () => {
  const html = render();
  assert.match(html, /Approve this invitation/);
  assert.match(html, /Your AI agent asks to add new@person\.test to the team of “Roscoff Voile”\./);
  assert.match(html, /They join as a member, never as an owner\./);
  assert.match(html, /new@person\.test will get an e-mail to join the store, valid 7 days\./);
  assert.match(html, /A member sees the store’s customers/);
  assert.match(html, /A word for your agent \(optional\)/);
  assert.match(html, /500 characters at most/);
  const atOnce = render({
    invitation: { email: "known@person.test", role: "member", joinsAtOnce: true },
  });
  assert.match(atOnce, /known@person\.test already has a Louez account/);
});

test("a note says why the last answer was not applied", () => {
  const html = render({ note: "This request changed" });
  assert.match(html, /role="alert"[^>]*>This request changed</);
  assert.doesNotMatch(render(), /role="alert"/);
});
