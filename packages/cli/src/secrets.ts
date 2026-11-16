/**
 * The API key's format, and the redaction every output goes through.
 *
 * A Louez API key is `lz_`, four lowercase letters or digits, `_`, and twenty
 * letters or digits: 28 characters (`generateApiKey`,
 * packages/api/src/services/api-keys.ts). The REST API takes API keys only:
 * it refuses OAuth access tokens (`CREDENTIAL_NOT_ACCEPTED`), so the CLI
 * takes no other credential.
 *
 * Redaction is a second line of defence, against a server or a library that
 * echoes the key back; the first is that the CLI itself never writes a key.
 * It replaces the complete key in exactly these forms: as is; with one level
 * of percent-encoding; inside a base64 or base64url run, of at most
 * `MAX_DECODED_TOKEN` characters, whose decoded bytes hold it; and in JSON,
 * after parsing, so JSON escapes are decoded first. Any other transformation
 * of the key (base64 split by whitespace or longer than the cap, double
 * percent-encoding, a key cut in parts…) is not redacted. Do not rely on
 * redaction: revoke a key a server echoed back.
 */

export const API_KEY_FORMAT = /^lz_[a-z0-9]{4}_[A-Za-z0-9]{20}$/;

export const API_KEY_SHAPE = "lz_, 4 lowercase letters or digits, _, then 20 letters or digits";

export function isApiKey(value: string): boolean {
  return API_KEY_FORMAT.test(value);
}

export const REDACTED = "[redacted]";

/**
 * The runs of text a key, or an encoded form of it, can be part of: letters,
 * digits and `_ - + / %`, with `=` only at the end (base64's padding). A key
 * is always inside one run; `=` ends a run, so `key=<key>` holds two.
 */
const TOKEN = /[A-Za-z0-9_\-+/%]+={0,2}/g;

/**
 * The longest run decoded as base64 (64 KiB): a key encoded inside a longer
 * base64 text is found up to there. A longer run is still searched for the
 * key as is and percent-encoded, which costs no decoding.
 */
export const MAX_DECODED_TOKEN = 64 * 1024;

/** A base64 or base64url text, padded or not, long enough to hold a key. */
const BASE64 = /^(?:[A-Za-z0-9+/]+|[A-Za-z0-9_-]+)={0,2}$/;
const MIN_BASE64_LENGTH = Math.ceil((28 * 4) / 3);

/**
 * `token` with `%XX` decoded (ASCII only), and for each decoded character
 * where it starts in `token`; `starts` has one more entry, the token's end.
 */
function percentDecode(token: string): { decoded: string; starts: number[] } {
  let decoded = "";
  const starts: number[] = [];
  for (let i = 0; i < token.length;) {
    const hex = token[i] === "%" ? token.slice(i + 1, i + 3) : "";
    const code = /^[0-7][0-9a-fA-F]$/.test(hex) ? Number.parseInt(hex, 16) : -1;
    starts.push(i);
    if (code >= 0) {
      decoded += String.fromCharCode(code);
      i += 3;
    } else {
      decoded += token[i];
      i += 1;
    }
  }
  starts.push(token.length);
  return { decoded, starts };
}

/** Hides the API keys in text, and in values before they are written as JSON. */
export class Redactor {
  readonly #keys = new Set<string>();

  /** Adds `value` when it is a well-formed key; ignores anything else. */
  add(value: string | undefined): void {
    if (value !== undefined && isApiKey(value)) this.#keys.add(value);
  }

  /** The token with every complete key in it, as is or percent-encoded, replaced. */
  #token(token: string): string {
    if (this.#keys.size === 0) return token;
    if (
      token.length >= MIN_BASE64_LENGTH &&
      token.length <= MAX_DECODED_TOKEN &&
      BASE64.test(token)
    ) {
      // A base64 text whose bytes hold a complete key is replaced whole.
      const bytes = Buffer.from(token, /[-_]/.test(token) ? "base64url" : "base64").toString(
        "latin1",
      );
      for (const key of this.#keys) if (bytes.includes(key)) return REDACTED;
    }
    const { decoded, starts } = percentDecode(token);
    const spans: Array<[number, number]> = [];
    for (const key of this.#keys) {
      for (let at = decoded.indexOf(key); at !== -1; at = decoded.indexOf(key, at + key.length)) {
        spans.push([starts[at] ?? 0, starts[at + key.length] ?? token.length]);
      }
    }
    if (spans.length === 0) return token;
    spans.sort((a, b) => a[0] - b[0]);
    let out = "";
    let from = 0;
    for (const [start, end] of spans) {
      if (start < from) continue;
      out += `${token.slice(from, start)}${REDACTED}`;
      from = end;
    }
    return out + token.slice(from);
  }

  /** One pass over the text's tokens: only a complete key, in one of its forms, is replaced. */
  text(text: string): string {
    return this.#keys.size === 0 ? text : text.replace(TOKEN, (token) => this.#token(token));
  }

  /**
   * `value` with every string in it redacted, property names included. A
   * name that is redacted keeps its property: it becomes `[redacted]`, or
   * `[redacted] (2)`, `(3)`… when that name is taken, so no property is lost.
   */
  value(value: unknown): unknown {
    if (typeof value === "string") return this.text(value);
    if (Array.isArray(value)) return value.map((item) => this.value(item));
    if (typeof value !== "object" || value === null) return value;
    const entries = Object.entries(value).map(([name, item]) => ({
      name,
      redacted: this.text(name),
      item: this.value(item),
    }));
    const taken = new Set(entries.filter((e) => e.redacted === e.name).map((e) => e.name));
    return Object.fromEntries(
      entries.map(({ name, redacted, item }) => {
        if (redacted === name) return [name, item];
        let unique = redacted;
        for (let n = 2; taken.has(unique); n++) unique = `${redacted} (${n})`;
        taken.add(unique);
        return [unique, item];
      }),
    );
  }
}
