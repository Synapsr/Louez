/** Help, from the manifest: the operation's summary, description and parameters. */
import { operationFields } from "./args.js";
import { GLOBAL_FLAGS } from "./globals.js";
import type { Field, Group, Manifest, Operation } from "./manifest.js";

const WIDTH = 80;

/** Wraps a paragraph to `WIDTH` columns, each line after `indent`. */
function wrap(text: string, indent = ""): string {
  return text
    .split(/\n+/)
    .map((paragraph) => {
      const lines: string[] = [];
      let line = "";
      for (const word of paragraph.split(/\s+/).filter(Boolean)) {
        if (line && indent.length + line.length + 1 + word.length > WIDTH) {
          lines.push(indent + line);
          line = word;
        } else line = line ? `${line} ${word}` : word;
      }
      if (line) lines.push(indent + line);
      return lines.join("\n");
    })
    .join("\n\n");
}

/** Two columns: a name, then its text wrapped under the second column. */
function table(rows: Array<[string, string]>): string {
  const width = Math.min(Math.max(...rows.map(([name]) => name.length)) + 2, 34);
  return rows
    .map(([name, text]) => {
      const lines = wrap(text, " ".repeat(width + 2)).trimStart();
      const head = `  ${name}`;
      return head.length + 1 >= width + 2
        ? `${head}\n${" ".repeat(width + 2)}${lines}`
        : `${head.padEnd(width + 2)}${lines}`;
    })
    .join("\n");
}

const EXIT_CODES_HELP = `Exit codes:
  0  The call succeeded; its JSON is on standard output.
  1  The API refused or failed; its error JSON and one line are on standard error.
  2  The command line is wrong: an unknown command or flag, a missing value.
  3  A person must act first: open the approval link printed on standard error,
     or check the preview, then run the printed command (or use --wait).
  4  Louez could not be reached, or did not answer in time.`;

const globalRows = (): Array<[string, string]> =>
  Object.entries(GLOBAL_FLAGS).map(([flag, { value, description }]) => [
    `--${flag}${value ? ` ${value}` : ""}`,
    description,
  ]);

export function mainHelp(manifest: Manifest, version: string): string {
  return `louez ${version}: every operation of the Louez REST API (${manifest.apiVersion}), from a terminal.

Usage:
  louez <group> <action> [arguments] [flags]
  louez <operationId> [arguments] [flags]     the MCP tool's name, such as reservations_list
  louez api <METHOD> <path> [--json <body>]   any operation, by its method and path
  louez auth login | status | logout

Groups:
${table(manifest.groups.map((group) => [group.name, group.description || group.title]))}

Flags:
${table(globalRows())}

Environment:
  LOUEZ_API_KEY     The API key, created in Louez under Settings > Integrations > MCP.
  LOUEZ_API_URL     The API's base URL, for a self-hosted Louez.
  XDG_CONFIG_HOME   \`louez auth login\` saves the key in $XDG_CONFIG_HOME/louez/config.json,
                    else ~/.config/louez/config.json (%APPDATA%\\louez on Windows).

Output is JSON on standard output: indented on a terminal, one line otherwise.

${EXIT_CODES_HELP}

Run \`louez <group> --help\` for a group's actions, and \`louez <group> <action> --help\` for one.`;
}

export function groupHelp(manifest: Manifest, group: Group): string {
  const operations = manifest.operations.filter((operation) => operation.group === group.name);
  return `${group.title}${group.description ? `\n\n${wrap(group.description)}` : ""}

Usage:
  louez ${group.name} <action> [arguments] [flags]

Actions:
${table(operations.map((operation) => [usageWords(operation), operation.summary]))}

Run \`louez ${group.name} <action> --help\` for an action's flags.`;
}

function usageWords(operation: Operation): string {
  return [operation.action, ...operation.pathParams.map((param) => `<${param.name}>`)].join(" ");
}

function fieldText(field: Field): string {
  const facts: string[] = [];
  if (field.required) facts.push("required");
  if (field.list) facts.push("repeat it, or give a JSON array");
  if (field.kind === "json") facts.push("JSON");
  if (field.nullable) facts.push("null clears it");
  if (field.enum) facts.push(`one of ${field.enum.join(", ")}`);
  const head = facts.length > 0 ? `(${facts.join("; ")}) ` : "";
  return `${head}${field.description ?? ""}`.trim();
}

function flagName(field: Field): string {
  if (field.kind === "boolean") return `--${field.flag}, --no-${field.flag}`;
  const value =
    field.kind === "integer" || field.kind === "number"
      ? "<number>"
      : field.kind === "json"
        ? "<json>"
        : "<value>";
  return `--${field.flag} ${value}`;
}

export function operationHelp(operation: Operation): string {
  const sections = [
    `${operation.summary}\n\n  ${operation.method} ${operation.path}\n\n${wrap(operation.description)}`,
    `Usage:\n  louez ${operation.group} ${usageWords(operation)}${operationFields(operation).length > 0 ? " [flags]" : ""}`,
  ];
  if (operation.pathParams.length > 0) {
    sections.push(
      `Arguments:\n${table(operation.pathParams.map((param) => [`<${param.name}>`, param.description ?? ""]))}`,
    );
  }
  if (operation.query.length > 0) {
    sections.push(
      `Query flags:\n${table(operation.query.map((field) => [flagName(field), fieldText(field)]))}`,
    );
  }
  if (operation.body) {
    const fields = operation.body.fields;
    sections.push(
      fields.length > 0
        ? `Body flags (or the whole body with --json):\n${table(fields.map((field) => [flagName(field), fieldText(field)]))}`
        : "Body: none to give.",
    );
  }
  const headers: string[] = [];
  if (operation.idempotent) headers.push("--idempotency-key: safe to repeat with the same key.");
  if (operation.confirmation) {
    headers.push("--confirmation: the token or approval id an earlier answer asked for.");
  }
  if (headers.length > 0) sections.push(`It takes:\n  ${headers.join("\n  ")}`);
  sections.push(`Operation id (MCP tool): ${operation.id}`);
  return sections.join("\n\n");
}
