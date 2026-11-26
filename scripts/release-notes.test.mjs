import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { addRelease, formatDate, parseNote, release, renderSection } from "./release-notes.mjs";

const note = (type, title, text = "Body.") => `---\ntype: ${type}\n---\n\n## ${title}\n\n${text}\n`;

const CHANGELOG = [
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
  "---",
  "",
  "## [2.3.0] - October 14, 2026",
  "",
  "- older",
  "",
].join("\n");

const EMPTY_UNRELEASED = CHANGELOG.replace("### 🤖 API\n\n- **Hand-written entry**\n\n", "");

/** A repository of its own: CHANGELOG.md and changes/ with the given notes. */
function fixture(t, { changelog = CHANGELOG, notes = {} } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "release-notes-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, "changes"));
  writeFileSync(path.join(root, "CHANGELOG.md"), changelog);
  for (const [file, text] of Object.entries(notes)) {
    writeFileSync(path.join(root, "changes", file), text);
  }
  return {
    root,
    changelog: () => readFileSync(path.join(root, "CHANGELOG.md"), "utf8"),
    pending: () => readdirSync(path.join(root, "changes")).filter((name) => name.endsWith(".md")),
  };
}

test("a note gives its type, its title and the text under the title", () => {
  assert.deepEqual(parseNote(note("fixed", "A refund reads as a refund", "One.\n\nTwo."), "a.md"), {
    file: "a.md",
    type: "fixed",
    title: "A refund reads as a refund",
    text: "One.\n\nTwo.",
  });
});

test("a note written with CRLF line endings reads as one written with LF", () => {
  const crlf = note("fixed", "A fix", "One.\n\nTwo.").replace(/\n/g, "\r\n");
  assert.deepEqual(
    parseNote(crlf, "a.md"),
    parseNote(note("fixed", "A fix", "One.\n\nTwo."), "a.md"),
  );
  const section = renderSection({
    version: "2.4.0",
    date: "2026-12-01",
    notes: [parseNote(crlf, "a.md")],
  });
  assert.ok(!section.includes("\r"));
});

test("a note without front matter, with an unknown type or without a title is refused", () => {
  assert.throws(() => parseNote("## Title\n\nBody.", "a.md"), /no front matter/);
  assert.throws(() => parseNote(note("security", "Title"), "a.md"), /type must be one of/);
  assert.throws(() => parseNote("---\nkind: new\n---\n\n## Title\n", "a.md"), /got none/);
  assert.throws(() => parseNote("---\ntype: new\n---\n\nNo heading.", "a.md"), /no "## " title/);
});

test("the type is the whole value: a comment after it is refused, not dropped", () => {
  assert.throws(
    () => parseNote(note("new # new | fixed", "Title"), "a.md"),
    /a\.md: type must be one of .*, got "new # new \| fixed"/,
  );
});

test("the date is written as the existing headings write it, and must exist", () => {
  assert.equal(formatDate("2026-11-25"), "November 25, 2026");
  assert.equal(formatDate("2028-02-29"), "February 29, 2028");
  assert.throws(() => formatDate("25/11/2026"), /YYYY-MM-DD/);
  assert.throws(() => formatDate("2026-13-01"), /2026-13-01 is not a date/);
  assert.throws(() => formatDate("2026-02-29"), /not a date/);
  assert.throws(() => formatDate("2026-04-31"), /not a date/);
  assert.throws(() => formatDate("2026-00-10"), /not a date/);
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

test("titles sort by code point, the same on every locale, non-ASCII included", () => {
  const titles = ["Économie", "zèbre", "Zeta", "Ångström", "alpha", "Alpha", "Ärger", "🚲 Bikes"];
  const section = renderSection({
    version: "2.4.0",
    date: "2026-12-01",
    notes: titles.map((title, index) => parseNote(note("new", title), `${index}.md`)),
  });
  const order = [...section.matchAll(/^- \*\*(.+)\*\*$/gm)].map((match) => match[1]);
  assert.deepEqual(order, [
    "Alpha",
    "Zeta",
    "alpha",
    "zèbre",
    "Ärger",
    "Ångström",
    "Économie",
    "🚲 Bikes",
  ]);
});

test("notes with the same title are both kept, in the order of their file names", () => {
  const section = renderSection({
    version: "2.4.0",
    date: "2026-12-01",
    notes: [
      parseNote(note("fixed", "Same title", "From b."), "b.md"),
      parseNote(note("fixed", "Same title", "From a."), "a.md"),
    ],
  });
  assert.equal(section.match(/- \*\*Same title\*\*/g).length, 2);
  assert.ok(section.indexOf("From a.") < section.indexOf("From b."));
});

test("a version that is not X.Y.Z is refused", () => {
  assert.throws(() => renderSection({ version: "v2.4", date: "2026-12-01", notes: [] }), /X\.Y\.Z/);
});

test("[Unreleased] moves under the new version and is left empty", () => {
  const { section, changelog } = addRelease(CHANGELOG, {
    version: "2.4.0",
    date: "2026-12-01",
    notes: [parseNote(note("fixed", "A fix"), "a.md")],
  });
  assert.ok(section.startsWith("## [2.4.0] - December 1, 2026\n\n### 🤖 API"));
  const unreleased = changelog.slice(
    changelog.indexOf("## [Unreleased]"),
    changelog.indexOf("## [2.4.0]"),
  );
  assert.equal(unreleased.replace("## [Unreleased]", "").replace(/[-\s]/g, ""), "");
  assert.ok(changelog.indexOf("Hand-written entry") > changelog.indexOf("## [2.4.0]"));
  assert.ok(changelog.indexOf("Hand-written entry") < changelog.indexOf("### 🩹 Fixed"));
  assert.ok(changelog.indexOf("## [2.4.0]") < changelog.indexOf("## [2.3.1]"));
});

test("a version the changelog has, whatever its date or place, is refused", () => {
  const notes = [parseNote(note("fixed", "A fix"), "a.md")];
  const { changelog } = addRelease(CHANGELOG, { version: "2.4.0", date: "2026-12-01", notes });
  for (const [version, date] of [
    ["2.4.0", "2026-12-01"],
    ["2.4.0", "2026-12-02"],
    ["2.3.0", "2026-12-01"],
  ]) {
    assert.throws(
      () => addRelease(changelog, { version, date, notes }),
      new RegExp(`CHANGELOG\\.md already has a \\[${version.replaceAll(".", "\\.")}\\] section`),
    );
  }
});

test("with no note, the section holds what [Unreleased] held", () => {
  const { section } = addRelease(CHANGELOG, { version: "2.4.0", date: "2026-12-01", notes: [] });
  assert.equal(
    section,
    "## [2.4.0] - December 1, 2026\n\n### 🤖 API\n\n- **Hand-written entry**\n",
  );
});

test("an empty changes/ with an empty [Unreleased] has nothing to release", (t) => {
  const repo = fixture(t, { changelog: EMPTY_UNRELEASED });
  assert.throws(
    () => release({ root: repo.root, version: "2.4.0", date: "2026-12-01", write: true }),
    /nothing to release/,
  );
  assert.equal(repo.changelog(), EMPTY_UNRELEASED);
});

test("without --write, nothing is written", (t) => {
  const repo = fixture(t, { notes: { "a.md": note("fixed", "A fix") } });
  const { section, notes } = release({ root: repo.root, version: "2.4.0", date: "2026-12-01" });
  assert.match(section, /- \*\*A fix\*\*/);
  assert.equal(notes.length, 1);
  assert.equal(repo.changelog(), CHANGELOG);
  assert.deepEqual(repo.pending(), ["a.md"]);
  assert.throws(
    () => release({ root: repo.root, version: "2.4.0", date: "2026-12-01", archive: true }),
    /--archive only works with --write/,
  );
});

test("--write --archive adds the section and moves the notes; a rerun the next day is refused", (t) => {
  const repo = fixture(t, {
    notes: {
      "a.md": note("fixed", "A fix"),
      "b.md": note("new", "A feature"),
      "README.md": "How to write a note.\n",
    },
  });
  release({ root: repo.root, version: "2.4.0", date: "2026-12-01", write: true, archive: true });
  const written = repo.changelog();
  assert.match(written, /## \[2\.4\.0\] - December 1, 2026\n\n### 🤖 API/);
  assert.match(written, /- \*\*A feature\*\*/);
  assert.deepEqual(readdirSync(path.join(repo.root, "changes")).sort(), ["README.md", "released"]);
  assert.deepEqual(readdirSync(path.join(repo.root, "changes", "released", "2.4.0")).sort(), [
    "a.md",
    "b.md",
  ]);
  assert.ok(!existsSync(path.join(repo.root, "CHANGELOG.md.draft")));

  writeFileSync(path.join(repo.root, "changes", "c.md"), note("fixed", "Another fix"));
  assert.throws(
    () =>
      release({
        root: repo.root,
        version: "2.4.0",
        date: "2026-12-02",
        write: true,
        archive: true,
      }),
    /already has a \[2\.4\.0\] section/,
  );
  assert.equal(repo.changelog(), written);
  assert.deepEqual(repo.pending(), ["README.md", "c.md"]);
});

test("a taken archive folder is refused before anything is written", (t) => {
  const repo = fixture(t, { notes: { "a.md": note("fixed", "A fix") } });
  mkdirSync(path.join(repo.root, "changes", "released", "2.4.0"), { recursive: true });
  assert.throws(
    () =>
      release({
        root: repo.root,
        version: "2.4.0",
        date: "2026-12-01",
        write: true,
        archive: true,
      }),
    /changes\/released\/2\.4\.0 already exists/,
  );
  assert.equal(repo.changelog(), CHANGELOG);
  assert.deepEqual(repo.pending(), ["a.md"]);
});

test("a note that does not parse stops the release before anything is written", (t) => {
  const repo = fixture(t, {
    notes: { "a.md": note("fixed", "A fix"), "b.md": note("security", "A leak") },
  });
  assert.throws(
    () =>
      release({
        root: repo.root,
        version: "2.4.0",
        date: "2026-12-01",
        write: true,
        archive: true,
      }),
    /b\.md: type must be one of/,
  );
  assert.equal(repo.changelog(), CHANGELOG);
  assert.deepEqual(repo.pending(), ["a.md", "b.md"]);
});

test(
  "a changelog that cannot be written moves the notes back, so a rerun finishes the release",
  { skip: process.getuid?.() === 0 && "root writes to read-only folders" },
  (t) => {
    const repo = fixture(t, { notes: { "a.md": note("fixed", "A fix") } });
    const options = {
      root: repo.root,
      version: "2.4.0",
      date: "2026-12-01",
      write: true,
      archive: true,
    };
    chmodSync(repo.root, 0o555);
    try {
      assert.throws(
        () => release(options),
        /EACCES[\s\S]*\nNothing was changed: fix this and run again\./,
      );
    } finally {
      chmodSync(repo.root, 0o755);
    }
    assert.equal(repo.changelog(), CHANGELOG);
    assert.deepEqual(repo.pending(), ["a.md"]);
    assert.ok(!existsSync(path.join(repo.root, "changes", "released", "2.4.0")));

    release(options);
    assert.match(repo.changelog(), /## \[2\.4\.0\]/);
    assert.deepEqual(repo.pending(), []);
  },
);
