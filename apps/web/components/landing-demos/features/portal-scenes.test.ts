import assert from "node:assert/strict";
import { test } from "node:test";
import { demo as access } from "./portal-access.demo";
import { demo as login } from "./portal-login.demo";
import { demo as quote } from "./portal-quote.demo";
import { demo as account } from "./portal-account.demo";

for (const [name, demo] of Object.entries({ access, login, quote, account })) {
  test(`${name} uses customer cues with reading time and stable targets`, () => {
    assert.equal(demo.actor, "customer");
    assert.ok(demo.duration >= 5000 && demo.duration <= 12000);
    for (const [index, cue] of demo.cues.entries()) {
      assert.ok(cue.at < demo.duration);
      assert.match(cue.selector, /^\[data-/);
      assert.doesNotMatch(cue.selector, /aria-label|:has-text|:text/);
      if (index > 0) assert.ok(cue.at > demo.cues[index - 1].at);
      if (cue.click || cue.press || cue.scroll || cue.type || cue.emit || cue.hover) {
        const move = demo.cues[index - 1];
        assert.ok(move);
        assert.equal(move.selector, cue.selector);
        assert.ok(cue.at - move.at >= 700 && cue.at - move.at <= 900);
        assert.equal(
          move.click ?? move.press ?? move.scroll ?? move.type ?? move.emit ?? move.hover,
          undefined,
        );
      }
    }
  });
}

test("the phone access loop opens the email locally and returns to the contract", () => {
  assert.equal(access.format, "phone");
  assert.ok(access.cues.some(({ emit }) => emit === "portal-open-email"));
  assert.ok(access.cues.some(({ scroll }) => scroll && scroll.y < 0));
  assert.equal(access.cues.at(-1)?.selector, '[data-demo-target="portal-contract"]');
});

test("login types email and six digits, while the quote stops before Stripe", () => {
  assert.deepEqual(
    login.cues.flatMap(({ type }) => (type ? [type.text] : [])),
    ["camille.martin@example.com", "482916"],
  );
  assert.equal(quote.cues.at(-1)?.selector, '[data-demo-target="portal-pay"]');
  assert.equal(quote.cues.at(-1)?.click, undefined);
});
