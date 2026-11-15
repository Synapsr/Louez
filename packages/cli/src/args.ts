/**
 * The command line, read against what it may hold: the global flags and an
 * operation's fields. util.parseArgs is not used: a generated boolean flag
 * also takes `--flag=false` and `--no-flag`, a value flag takes the next
 * argument even when it starts with a dash (`--amount -20.00`), and the
 * operation, so its flags, is known only once the command is read.
 */
import { GLOBAL_FLAGS, isGlobalFlag } from "./globals.js";
import type { Field, Operation } from "./manifest.js";

/** A command line the CLI cannot run: exit code 2. */
export class UsageError extends Error {}

export type FlagValues = Map<string, Array<string | boolean>>;

interface ParsedLine {
  /** The command's words and the positional arguments, in order. */
  positionals: string[];
  values: FlagValues;
}

/** Whether `--flag` takes a value (true), is a switch (false), or is unknown (undefined). */
type FlagLookup = (flag: string) => boolean | undefined;

export const globalLookup: FlagLookup = (flag) =>
  isGlobalFlag(flag) ? GLOBAL_FLAGS[flag].value !== null : undefined;

/** The lookup of an operation's command: its fields, then the global flags. */
export function operationLookup(operation: Operation): FlagLookup {
  const fields = new Map(operationFields(operation).map((field) => [field.flag, field]));
  return (flag) => {
    const field = fields.get(flag);
    if (field) return field.kind !== "boolean";
    return globalLookup(flag);
  };
}

/** The fields an operation takes as flags: its query, then its body's. */
export function operationFields(operation: Operation): Field[] {
  return [...operation.query, ...(operation.body?.fields ?? [])];
}

export function parseLine(argv: readonly string[], lookup: FlagLookup): ParsedLine {
  const positionals: string[] = [];
  const values: FlagValues = new Map();
  const add = (flag: string, value: string | boolean) =>
    values.set(flag, [...(values.get(flag) ?? []), value]);

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;
    if (token === "--") {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    if (token === "-h") {
      add("help", true);
      continue;
    }
    if (!token.startsWith("--")) {
      if (token.startsWith("-") && token !== "-" && !/^-\d/.test(token)) {
        throw new UsageError(`Unknown option ${token}.`);
      }
      positionals.push(token);
      continue;
    }

    const equals = token.indexOf("=");
    const flag = equals === -1 ? token.slice(2) : token.slice(2, equals);
    const inline = equals === -1 ? undefined : token.slice(equals + 1);
    const takesValue = lookup(flag);

    if (takesValue === undefined) {
      const negated = flag.startsWith("no-") ? flag.slice(3) : undefined;
      if (negated && lookup(negated) === false && inline === undefined) {
        add(negated, false);
        continue;
      }
      throw new UsageError(`Unknown flag --${flag}.`);
    }
    if (takesValue) {
      const value = inline ?? argv[++i];
      if (value === undefined) throw new UsageError(`--${flag} needs a value.`);
      add(flag, value);
    } else if (inline === undefined) {
      add(flag, true);
    } else if (inline === "true" || inline === "false") {
      add(flag, inline === "true");
    } else {
      throw new UsageError(`--${flag} is true or false, not "${inline}".`);
    }
  }
  return { positionals, values };
}

/** The last value given to a flag. */
export function lastValue(values: FlagValues, flag: string): string | boolean | undefined {
  return values.get(flag)?.at(-1);
}

export function stringFlag(values: FlagValues, flag: string): string | undefined {
  const value = lastValue(values, flag);
  return typeof value === "string" ? value : undefined;
}

/**
 * The words before the first flag the global flags do not explain: where the
 * command is (`louez --api-url … reservations list --status pending`).
 * Returns the indexes of the first `count` words.
 */
export function commandWords(argv: readonly string[], count: number): number[] {
  const words: number[] = [];
  for (let i = 0; i < argv.length && words.length < count; i++) {
    const token = argv[i]!;
    if (token === "--") break;
    if (token === "-h") continue;
    if (token.startsWith("--")) {
      const flag = token.slice(2).split("=")[0]!;
      const takesValue = globalLookup(flag);
      if (takesValue === undefined) break;
      if (takesValue && !token.includes("=")) i++;
      continue;
    }
    words.push(i);
  }
  return words;
}

/** Reads `--json`'s text: inline, `@file`, or `-` for standard input. */
export type SourceReader = (spec: string) => Promise<string>;

interface Input {
  /** The path, its parameters filled in and encoded. */
  path: string;
  query: URLSearchParams;
  /** The JSON body; undefined when none is sent. */
  body: unknown;
}

function parseJson(text: string, what: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new UsageError(`${what} is not valid JSON.`);
  }
}

/** One flag's text as the value its field takes. */
function convertValue(field: Field, raw: string | boolean): unknown {
  const flag = `--${field.flag}`;
  if (field.kind === "boolean") {
    if (typeof raw === "boolean") return raw;
    throw new UsageError(`${flag} is a switch: ${flag}, ${flag}=false or --no-${field.flag}.`);
  }
  if (typeof raw === "boolean") throw new UsageError(`${flag} needs a value.`);
  if (field.nullable && raw === "null") return null;
  switch (field.kind) {
    case "integer":
      if (!/^-?\d+$/.test(raw)) throw new UsageError(`${flag} is a whole number, not "${raw}".`);
      return Number(raw);
    case "number": {
      const number = Number(raw);
      if (raw.trim() === "" || !Number.isFinite(number)) {
        throw new UsageError(`${flag} is a number, not "${raw}".`);
      }
      return number;
    }
    case "json":
      return parseJson(raw, flag);
    default:
      if (field.enum && !field.enum.includes(raw)) {
        throw new UsageError(`${flag} is one of ${field.enum.join(", ")}; not "${raw}".`);
      }
      return raw;
  }
}

/** A field's value from all the times its flag was given. */
function fieldValue(field: Field, raws: Array<string | boolean>): unknown {
  if (!field.list) return convertValue(field, raws.at(-1)!);
  // A JSON array, or the flag repeated.
  if (raws.length === 1 && typeof raws[0] === "string" && raws[0].trimStart().startsWith("[")) {
    const list = parseJson(raws[0], `--${field.flag}`);
    if (!Array.isArray(list)) throw new UsageError(`--${field.flag} is a list.`);
    return list;
  }
  return raws.map((raw) => convertValue(field, raw));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Query parameters as oRPC reads them: an array in bracket notation. */
function appendQuery(query: URLSearchParams, name: string, value: unknown): void {
  if (value === undefined) return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => appendQuery(query, `${name}[${index}]`, item));
  } else if (isPlainObject(value)) {
    for (const [key, item] of Object.entries(value)) appendQuery(query, `${name}[${key}]`, item);
  } else {
    query.append(name, String(value));
  }
}

/** Fills `{name}` in a path with the values given, encoded. */
function fillPath(template: string, values: readonly string[]): string {
  let index = 0;
  return template.replace(/\{[^}]+\}/g, () => encodeURIComponent(values[index++]!));
}

/** The request an operation's command line asks for. */
export async function buildInput(
  operation: Operation,
  line: ParsedLine,
  readSource: SourceReader,
): Promise<Input> {
  const args = line.positionals;
  const names = operation.pathParams.map((param) => `<${param.name}>`);
  if (args.length < operation.pathParams.length) {
    throw new UsageError(`Missing ${names.slice(args.length).join(" ")}.`);
  }
  if (args.length > operation.pathParams.length) {
    throw new UsageError(`Unexpected argument "${args[operation.pathParams.length]}".`);
  }
  for (const [i, value] of args.entries()) {
    if (value === "") throw new UsageError(`${names[i]} is empty.`);
  }

  const jsonSpec = stringFlag(line.values, "json");
  let base: Record<string, unknown> | undefined;
  if (jsonSpec !== undefined) {
    if (operation.method !== "GET" && !operation.body) {
      throw new UsageError(`${operation.method} ${operation.path} takes no body: drop --json.`);
    }
    const parsed = parseJson(await readSource(jsonSpec), "--json");
    if (!isPlainObject(parsed)) throw new UsageError("--json is a JSON object.");
    base = parsed;
  }

  const fromFlags: Record<string, unknown> = {};
  for (const field of operationFields(operation)) {
    const raws = line.values.get(field.flag);
    if (raws) fromFlags[field.name] = fieldValue(field, raws);
  }

  const query = new URLSearchParams();
  let body: unknown;
  if (operation.method === "GET" || !operation.body) {
    const fields = { ...base, ...fromFlags };
    const missing = operation.query.filter((field) => field.required && !(field.name in fields));
    if (missing.length > 0) {
      throw new UsageError(`Missing ${missing.map((field) => `--${field.flag}`).join(", ")}.`);
    }
    for (const [name, value] of Object.entries(fields)) appendQuery(query, name, value);
  } else {
    for (const field of operation.query) {
      if (field.name in fromFlags) appendQuery(query, field.name, fromFlags[field.name]);
    }
    const bodyFields = Object.fromEntries(
      operation.body.fields
        .filter((field) => field.name in fromFlags)
        .map((field) => [field.name, fromFlags[field.name]]),
    );
    const sent = { ...base, ...bodyFields };
    const missing = operation.body.fields.filter(
      (field) => field.required && !(field.name in sent),
    );
    if (missing.length > 0) {
      throw new UsageError(
        `Missing ${missing.map((field) => `--${field.flag}`).join(", ")} (or give the body with --json).`,
      );
    }
    // Always a JSON body: one without a Content-Type is refused (415).
    body = sent;
  }

  return { path: fillPath(operation.path, args), query, body };
}
