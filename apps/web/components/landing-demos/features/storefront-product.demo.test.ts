import assert from "node:assert/strict";
import test from "node:test";
import { demo as product } from "./storefront-product.demo";
import { demo as pricing } from "./storefront-pricing.demo";
import { demo as quickAdd } from "./storefront-quick-add.demo";
import { demo as extras } from "./storefront-extras.demo";

for (const [name, config] of Object.entries({ product, pricing, quickAdd, extras })) {
  test(`${name}: customer loop has stable selectors, a preceding move and reading time`, () => {
    assert.equal(config.actor, "customer");
    assert.ok(config.duration >= 5000 && config.duration <= 12000);
    let previous = -1;
    for (const [index, cue] of config.cues.entries()) {
      assert.ok(cue.at > previous && cue.at < config.duration);
      assert.match(cue.selector, /\[data-/);
      assert.doesNotMatch(cue.selector, /aria-label|:has-text|text=/);
      if (cue.click || cue.press || cue.scroll || cue.hover || cue.type || cue.draw || cue.emit) {
        const move = config.cues[index - 1];
        assert.ok(move);
        assert.equal(move.selector, cue.selector);
        assert.ok(cue.at - move.at >= 700 && cue.at - move.at <= 900);
        assert.equal(move.click, undefined);
        assert.equal(move.press, undefined);
        assert.equal(move.scroll, undefined);
      }
      previous = cue.at;
    }
    assert.ok(config.duration - previous >= 1500);
  });
}
