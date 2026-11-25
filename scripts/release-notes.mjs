#!/usr/bin/env node
/**
 * Turns the change notes waiting in `changes/` into the English section of a
 * release in CHANGELOG.md (docs/release.md).
 *
 *   pnpm release:notes 2.4.0                  print the section, change nothing
 *   pnpm release:notes 2.4.0 --write          add it to CHANGELOG.md
 *   pnpm release:notes 2.4.0 --write --archive
 *                                             and move the notes to changes/released/2.4.0/
 *   --date 2026-12-01                         the release date (default: today, UTC)
 *
 * With --write, what [Unreleased] holds moves under the new version, above the
 * notes, and [Unreleased] is left empty. The French section is not touched: it
 * is written by hand from the English one.
 *
 * Everything is checked before anything is written: every note, the date, a
 * version CHANGELOG.md has no section for yet, a free archive folder. The notes
 * are moved first and CHANGELOG.md is replaced last, in one step; if a step
 * fails, the notes are moved back, so running again finishes the release.
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

/** The note types, in the order their sections appear. */
export const SECTIONS = [
  { title: "✨ New", types: ["new", "added"] },
  { title: "🚀 Improved", types: ["improved"] },
  { title: "🔁 Changed", types: ["changed"] },
  { title: "🩹 Fixed", types: ["fixed"] },
];

const KNOWN_TYPES = new Set(SECTIONS.flatMap((section) => section.types));
const VERSION = /^\d+\.\d+\.\d+$/;
const VERSION_HEADING = /^## \[(\d+\.\d+\.\d+)\]/gm;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** One note: its front matter `type`, its `## ` title and the text under it. */
export function parseNote(text, file) {
  const match = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text.replace(/\r\n?/g, "\n"));
  if (!match) throw new Error(`${file}: no front matter`);
  const type = /^type:(.*)$/m.exec(match[1])?.[1].trim();
  if (!KNOWN_TYPES.has(type)) {
    const got = type === undefined ? "none" : `"${type}"`;
    throw new Error(`${file}: type must be one of ${[...KNOWN_TYPES].join(", ")}, got ${got}`);
  }
  const body = match[2].trim();
  const heading = /^##\s+(.+)$/m.exec(body);
  if (!heading) throw new Error(`${file}: no "## " title`);
  const noteText = body.slice(heading.index + heading[0].length).trim();
  return { file, type, title: heading[1].trim(), text: noteText };
}

/** "November 25, 2026", as the existing headings write it. */
export function formatDate(isoDate) {
  if (!DATE.test(isoDate)) throw new Error(`date must be YYYY-MM-DD, got ${isoDate}`);
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new Error(`${isoDate} is not a date`);
  }
  return `${MONTHS[month - 1]} ${day}, ${year}`;
}

/** UTF-8 bytes sort as Unicode code points: the same order on every machine and locale. */
const byCodePoint = (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b));

/**
 * The version's section: a heading, then one sub-section per type that has
 * notes. Notes are sorted by title, compared by Unicode code point rather than
 * by any locale (capitals before lower case, accented letters after "z");
 * notes with the same title keep the order of their file names.
 */
export function renderSection({ version, date, notes, carried = "" }) {
  if (!VERSION.test(version)) throw new Error(`version must be X.Y.Z, got ${version}`);
  const parts = [`## [${version}] - ${formatDate(date)}`];
  if (carried) parts.push(carried);
  for (const section of SECTIONS) {
    const items = notes
      .filter((note) => section.types.includes(note.type))
      .sort((a, b) => byCodePoint(a.title, b.title) || byCodePoint(a.file, b.file));
    if (items.length === 0) continue;
    const bullets = items.map((note) => {
      const indented = note.text
        .split("\n")
        .map((line) => (line.trim() ? `  ${line}` : ""))
        .join("\n");
      return note.text ? `- **${note.title}**\n\n${indented}` : `- **${note.title}**`;
    });
    parts.push(`### ${section.title}\n\n${bullets.join("\n\n")}`);
  }
  return `${parts.join("\n\n")}\n`;
}

/** The changelog cut around what [Unreleased] holds, which is returned as `carried`. */
function splitUnreleased(changelog) {
  const start = changelog.indexOf("## [Unreleased]");
  if (start === -1) throw new Error("CHANGELOG.md has no ## [Unreleased] heading");
  const bodyStart = changelog.indexOf("\n", start) + 1;
  const next = /^## \[\d+\.\d+\.\d+\]/m.exec(changelog.slice(bodyStart));
  if (!next) throw new Error("CHANGELOG.md has no released version after [Unreleased]");
  const bodyEnd = bodyStart + next.index;
  const carried = changelog
    .slice(bodyStart, bodyEnd)
    .replace(/\n---\s*$/, "")
    .trim();
  return { before: changelog.slice(0, bodyStart), after: changelog.slice(bodyEnd), carried };
}

/**
 * The version's section and the changelog with it under an emptied
 * [Unreleased]. A version the changelog already has a section for, whatever
 * its date and wherever it stands, is refused, and so is a release with no
 * note and nothing in [Unreleased].
 */
export function addRelease(changelog, { version, date, notes }) {
  const { before, after, carried } = splitUnreleased(changelog);
  const section = renderSection({ version, date, notes, carried });
  if ([...changelog.matchAll(VERSION_HEADING)].some((heading) => heading[1] === version)) {
    throw new Error(`CHANGELOG.md already has a [${version}] section; pick another version`);
  }
  if (notes.length === 0 && !carried) {
    throw new Error("nothing to release: no change note, and [Unreleased] is empty");
  }
  return { section, changelog: `${before}\n---\n\n${section}\n---\n\n${after}` };
}

export function readNotes(directory) {
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md") && entry.name !== "README.md")
    .map((entry) => entry.name)
    .sort()
    .map((name) => parseNote(readFileSync(path.join(directory, name), "utf8"), name));
}

/** Moves the archived notes back to changes/; returns those that could not be. */
function undoArchive({ changesDir, archiveDir, moved }) {
  const stuck = moved.filter((file) => {
    try {
      renameSync(path.join(archiveDir, file), path.join(changesDir, file));
      return false;
    } catch {
      return true;
    }
  });
  if (stuck.length === 0) rmSync(archiveDir, { recursive: true, force: true });
  return stuck;
}

/**
 * Builds the release of `version` from `root`'s changes/ and CHANGELOG.md.
 * Without `write` nothing is written; `archive` needs `write`.
 */
export function release({ root, version, date, write = false, archive = false }) {
  if (archive && !write) throw new Error("--archive only works with --write");
  const changesDir = path.join(root, "changes");
  const changelogPath = path.join(root, "CHANGELOG.md");
  const archiveDir = path.join(changesDir, "released", version);
  const notes = readNotes(changesDir);
  const { section, changelog } = addRelease(readFileSync(changelogPath, "utf8"), {
    version,
    date,
    notes,
  });
  if (archive && existsSync(archiveDir)) {
    throw new Error(`${path.relative(root, archiveDir)} already exists`);
  }
  if (!write) return { section, notes };

  const draft = `${changelogPath}.draft`;
  const moved = [];
  try {
    if (archive) {
      mkdirSync(archiveDir, { recursive: true });
      for (const note of notes) {
        renameSync(path.join(changesDir, note.file), path.join(archiveDir, note.file));
        moved.push(note.file);
      }
    }
    writeFileSync(draft, changelog);
    renameSync(draft, changelogPath);
  } catch (error) {
    rmSync(draft, { force: true });
    const stuck = archive ? undoArchive({ changesDir, archiveDir, moved }) : [];
    const status =
      stuck.length === 0
        ? "Nothing was changed: fix this and run again."
        : `CHANGELOG.md is unchanged, but ${stuck.join(", ")} could not be moved back from ${path.relative(root, archiveDir)}/: move them to changes/, then run again.`;
    throw new Error(`${error.message}\n${status}`, { cause: error });
  }
  return { section, notes };
}

function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      date: { type: "string" },
      write: { type: "boolean", default: false },
      archive: { type: "boolean", default: false },
    },
  });
  if (positionals.length !== 1) {
    console.error("Usage: pnpm release:notes <X.Y.Z> [--date YYYY-MM-DD] [--write] [--archive]");
    return 1;
  }
  const [version] = positionals;
  const { section, notes } = release({
    root: path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
    version,
    date: values.date ?? new Date().toISOString().slice(0, 10),
    write: values.write,
    archive: values.archive,
  });

  if (!values.write) {
    process.stdout.write(section);
    console.error(
      `\n${notes.length} note(s). Nothing written; add --write to update CHANGELOG.md.`,
    );
    return 0;
  }
  console.error(`CHANGELOG.md: [${version}] added with ${notes.length} note(s).`);
  if (values.archive) console.error(`Notes moved to changes/released/${version}/.`);
  console.error("Remember the French section of CHANGELOG.md, written from the English one.");
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
