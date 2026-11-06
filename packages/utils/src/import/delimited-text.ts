export interface DelimitedTable {
  delimiter: "," | ";" | "\t";
  headers: string[];
  rows: Record<string, string>[];
}

const DELIMITERS = [",", ";", "\t"] as const;

/** Splits text into records and cells, honouring quotes, doubled quotes and line breaks inside a cell (RFC 4180). */
const splitCells = (text: string, delimiter: string): string[][] => {
  const records: string[][] = [];
  let record: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"' && cell === "") {
      quoted = true;
    } else if (char === delimiter) {
      record.push(cell);
      cell = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      record.push(cell);
      records.push(record);
      record = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  if (cell !== "" || record.length > 0) {
    record.push(cell);
    records.push(record);
  }
  return records.filter((cells) => cells.some((value) => value.trim() !== ""));
};

/**
 * The separator of a file nobody told us about: a spreadsheet paste is tabs,
 * a French Excel export is semicolons, the rest is commas. The one that cuts
 * the first lines into the most, equally sized, pieces wins.
 */
export function detectDelimiter(text: string): DelimitedTable["delimiter"] {
  const sample = text
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "")
    .slice(0, 8)
    .join("\n");
  let best: DelimitedTable["delimiter"] = ",";
  let bestScore = 0;
  for (const delimiter of DELIMITERS) {
    const widths = splitCells(sample, delimiter).map((cells) => cells.length);
    const width = widths[0] ?? 0;
    const consistent = widths.every((value) => value === width);
    const score = width > 1 ? width * (consistent ? 2 : 1) : 0;
    if (score > bestScore) {
      best = delimiter;
      bestScore = score;
    }
  }
  return best;
}

/** Column names as found, blank ones numbered and repeats suffixed so every column stays addressable. */
const toHeaders = (cells: string[]): string[] => {
  const seen = new Map<string, number>();
  return cells.map((cell, index) => {
    const name = cell.trim() || `Colonne ${index + 1}`;
    const count = (seen.get(name) ?? 0) + 1;
    seen.set(name, count);
    return count === 1 ? name : `${name} (${count})`;
  });
};

/**
 * A delimited text (CSV file, TSV, cells pasted from a spreadsheet) as a table
 * keyed by its first line. Cells are trimmed; nothing is interpreted.
 */
export function parseDelimitedText(text: string): DelimitedTable {
  const content = text.replace(/^﻿/, "");
  const delimiter = detectDelimiter(content);
  const [first, ...rest] = splitCells(content, delimiter);
  if (!first) return { delimiter, headers: [], rows: [] };

  const headers = toHeaders(first);
  const rows = rest.map((cells) =>
    Object.fromEntries(headers.map((header, index) => [header, (cells[index] ?? "").trim()])),
  );
  return { delimiter, headers, rows };
}
