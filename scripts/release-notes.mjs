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
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** The note types, in the order their sections appear. */
export const SECTIONS = [
  { title: "✨ New", types: ["new", "added"] },
  { title: "🚀 Improved", types: ["improved"] },
  { title: "🔁 Changed", types: ["changed"] },
  { title: "🩹 Fixed", types: ["fixed"] },
];

const KNOWN_TYPES = new Set(SECTIONS.flatMap((section) => section.types));
const VERSION = /^\d+\.\d+\.\d+$/;
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
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(text);
  if (!match) throw new Error(`${file}: no front matter`);
  const type = /^type:\s*(\S+)\s*$/m.exec(match[1])?.[1];
  if (!type || !KNOWN_TYPES.has(type)) {
    throw new Error(`${file}: type must be one of ${[...KNOWN_TYPES].join(", ")}`);
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
  return `${MONTHS[month - 1]} ${day}, ${year}`;
}

/** The version's section: a heading, then one sub-section per type that has notes. */
export function renderSection({ version, date, notes, carried = "" }) {
  if (!VERSION.test(version)) throw new Error(`version must be X.Y.Z, got ${version}`);
  const parts = [`## [${version}] - ${formatDate(date)}`];
  if (carried.trim()) parts.push(carried.trim());
  for (const section of SECTIONS) {
    const items = notes
      .filter((note) => section.types.includes(note.type))
      .sort((a, b) => a.title.localeCompare(b.title));
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

/**
 * The changelog with the section added under [Unreleased]. What [Unreleased]
 * held is returned as `carried`, for the caller to put in the section.
 */
export function splitUnreleased(changelog) {
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

export function insertSection(changelog, section) {
  const { before, after } = splitUnreleased(changelog);
  if (after.startsWith(section.split("\n")[0])) throw new Error("this version is already there");
  return `${before}\n---\n\n${section}\n---\n\n${after}`;
}

export function readNotes(directory) {
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md") && entry.name !== "README.md")
    .map((entry) => entry.name)
    .sort()
    .map((name) => parseNote(readFileSync(path.join(directory, name), "utf8"), name));
}

function main(argv) {
  const args = argv.slice(2);
  const version = args.find((arg) => !arg.startsWith("--"));
  const dateIndex = args.indexOf("--date");
  const date = dateIndex === -1 ? new Date().toISOString().slice(0, 10) : args[dateIndex + 1];
  if (!version) {
    console.error("Usage: pnpm release:notes <X.Y.Z> [--date YYYY-MM-DD] [--write] [--archive]");
    return 1;
  }

  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const changesDir = path.join(root, "changes");
  const changelogPath = path.join(root, "CHANGELOG.md");
  const notes = readNotes(changesDir);
  const changelog = readFileSync(changelogPath, "utf8");
  const { carried } = splitUnreleased(changelog);
  const section = renderSection({ version, date, notes, carried });

  if (!args.includes("--write")) {
    process.stdout.write(section);
    console.error(
      `\n${notes.length} note(s). Nothing written; add --write to update CHANGELOG.md.`,
    );
    return 0;
  }

  writeFileSync(changelogPath, insertSection(changelog, section));
  console.error(`CHANGELOG.md: [${version}] added with ${notes.length} note(s).`);
  if (args.includes("--archive")) {
    const target = path.join(changesDir, "released", version);
    if (existsSync(target)) throw new Error(`${path.relative(root, target)} already exists`);
    mkdirSync(target, { recursive: true });
    for (const note of notes)
      renameSync(path.join(changesDir, note.file), path.join(target, note.file));
    console.error(`Notes moved to ${path.relative(root, target)}/.`);
  }
  console.error("Remember the French section of CHANGELOG.md, written from the English one.");
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main(process.argv);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
