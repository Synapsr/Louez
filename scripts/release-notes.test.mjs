import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  formatDate,
  insertSection,
  parseNote,
  readNotes,
  renderSection,
  splitUnreleased,
} from "./release-notes.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const note = (type, title, text = "Body.") => `---\ntype: ${type}\n---\n\n## ${title}\n\n${text}\n`;

test("a note gives its type, its title and the text under the title", () => {
  assert.deepEqual(parseNote(note("fixed", "A refund reads as a refund", "One.\n\nTwo."), "a.md"), {
    file: "a.md",
    type: "fixed",
    title: "A refund reads as a refund",
    text: "One.\n\nTwo.",
  });
});

test("a note without front matter, with an unknown type or without a title is refused", () => {
  assert.throws(() => parseNote("## Title\n\nBody.", "a.md"), /no front matter/);
  assert.throws(() => parseNote(note("security", "Title"), "a.md"), /type must be one of/);
  assert.throws(() => parseNote("---\ntype: new\n---\n\nNo heading.", "a.md"), /no "## " title/);
});

test("the date is written as the existing headings write it", () => {
  assert.equal(formatDate("2026-11-25"), "November 25, 2026");
  assert.throws(() => formatDate("25/11/2026"), /YYYY-MM-DD/);
});

test("the section groups the notes by type, in a fixed order, sorted by title", () => {
  const section = renderSection({
    version: "2.4.0",
    date: "2026-12-01",
    notes: [
      parseNote(note("fixed", "Zeta fix"), "z.md"),
      parseNote(note("new", "Beta feature"), "b.md"),
      parseNote(note("added", "Alpha feature"), "a.md"),
      parseNote(note("fixed", "Alpha fix"), "f.md"),
    ],
  });
  assert.ok(section.startsWith("## [2.4.0] - December 1, 2026\n"));
  assert.ok(section.indexOf("### ✨ New") < section.indexOf("### 🩹 Fixed"));
  assert.ok(section.indexOf("Alpha feature") < section.indexOf("Beta feature"));
  assert.ok(section.indexOf("Alpha fix") < section.indexOf("Zeta fix"));
  assert.ok(!section.includes("### 🚀 Improved"), "an empty type has no sub-section");
  assert.match(section, /- \*\*Alpha fix\*\*\n\n {2}Body\./);
});

test("a version that is not X.Y.Z is refused", () => {
  assert.throws(() => renderSection({ version: "v2.4", date: "2026-12-01", notes: [] }), /X\.Y\.Z/);
});

test("[Unreleased] moves under the new version and is left empty", () => {
  const changelog = [
    "# Changelog",
    "",
    "## [Unreleased]",
    "",
    "### 🤖 API",
    "",
    "- **Hand-written entry**",
    "",
    "---",
    "",
    "## [2.3.1] - October 14, 2026",
    "",
    "- old",
    "",
  ].join("\n");
  const { carried } = splitUnreleased(changelog);
  assert.equal(carried, "### 🤖 API\n\n- **Hand-written entry**");
  const section = renderSection({
    version: "2.4.0",
    date: "2026-12-01",
    notes: [parseNote(note("fixed", "A fix"), "a.md")],
    carried,
  });
  const updated = insertSection(changelog, section);
  const unreleased = updated.slice(
    updated.indexOf("## [Unreleased]"),
    updated.indexOf("## [2.4.0]"),
  );
  assert.equal(unreleased.replace("## [Unreleased]", "").replace(/[-\s]/g, ""), "");
  assert.ok(updated.indexOf("Hand-written entry") > updated.indexOf("## [2.4.0]"));
  assert.ok(updated.indexOf("Hand-written entry") < updated.indexOf("### 🩹 Fixed"));
  assert.ok(updated.indexOf("## [2.4.0]") < updated.indexOf("## [2.3.1]"));
  assert.throws(() => insertSection(updated, section), /already there/);
});

test("every note waiting in changes/ parses, and the repository's changelog has [Unreleased]", () => {
  const notes = readNotes(path.join(ROOT, "changes"));
  assert.ok(notes.length > 0);
  assert.doesNotThrow(() => splitUnreleased(readFileSync(path.join(ROOT, "CHANGELOG.md"), "utf8")));
});
