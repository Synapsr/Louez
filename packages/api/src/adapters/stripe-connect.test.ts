import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, it, mock } from "node:test";

// tsx loads @louez/utils as CommonJS, whose `export *` names ESM cannot see.
const require = createRequire(import.meta.url);
mock.module("@louez/utils", { namedExports: require("@louez/utils") });

const { toProductDescription } = await import("./stripe-connect");

describe("toProductDescription", () => {
  it("drops the editor tags Stripe rejects", () => {
    assert.equal(
      toProductDescription(
        "<p>Location de <strong>sonorisation</strong> à Bourgoin.</p><p><strong>Téléphone</strong> : 06 07 19 75 57</p>",
      ),
      "Location de sonorisation à Bourgoin. Téléphone : 06 07 19 75 57",
    );
  });

  it("decodes ampersands but never rebuilds a tag", () => {
    assert.equal(
      toProductDescription("<p>Sono &amp; Lumière &lt;b&gt;</p>"),
      "Sono & Lumière &lt;b&gt;",
    );
  });

  it("caps the text at 500 characters", () => {
    assert.equal(toProductDescription(`<p>${"a".repeat(600)}</p>`)?.length, 500);
  });

  it("returns undefined when there is no visible text", () => {
    assert.equal(toProductDescription(null), undefined);
    assert.equal(toProductDescription("<p></p>"), undefined);
    assert.equal(toProductDescription("<p>&nbsp;</p>"), undefined);
  });
});
