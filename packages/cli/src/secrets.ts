/**
 * The API key's format, and the redaction every output goes through.
 *
 * A Louez API key is `lz_`, four lowercase letters or digits, `_`, and twenty
 * letters or digits: 28 characters (`generateApiKey`,
 * packages/api/src/services/api-keys.ts). The REST API takes API keys only:
 * it refuses OAuth access tokens (`CREDENTIAL_NOT_ACCEPTED`), so the CLI
 * takes no other credential.
 */

export const API_KEY_FORMAT = /^lz_[a-z0-9]{4}_[A-Za-z0-9]{20}$/;

export const API_KEY_SHAPE = "lz_, 4 lowercase letters or digits, _, then 20 letters or digits";

export function isApiKey(value: string): boolean {
  return API_KEY_FORMAT.test(value);
}

/**
 * Whether a value is redacted as a credential: a key, or a value that starts
 * like one (a key mistyped or cut short, which the CLI refuses but which is
 * still most of a secret). Nothing else is: redacting `1` or `0` would mangle
 * `{"count":1}` and the version.
 */
export function isSecretLike(value: string): boolean {
  return isApiKey(value) || (value.startsWith("lz_") && value.length >= 8);
}

export const REDACTED = "[redacted]";

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Matches `secret` with any subset of its characters percent-encoded, in
 * either case of hex digit: `lz_ab`, `lz%5Fab`, `%6C%7A_%61b`…
 */
function percentEncodedForms(secret: string): RegExp {
  const characters = [...new TextEncoder().encode(secret)].map((byte) => {
    const char = String.fromCharCode(byte);
    const hex = byte.toString(16).padStart(2, "0");
    const hexPattern = [...hex]
      .map((digit) => `[${digit.toLowerCase()}${digit.toUpperCase()}]`)
      .join("");
    return byte < 0x80 ? `(?:${escapeRegExp(char)}|%${hexPattern})` : `%${hexPattern}`;
  });
  return new RegExp(characters.join(""), "g");
}

const toBase64Url = (base64: string) => base64.replace(/\+/g, "-").replace(/\//g, "_");

/**
 * The base64 and base64url forms of `secret`, and of `Bearer <secret>`, with
 * and without padding; and the part every base64 of a longer text holding
 * `secret` shares, at each of its three alignments (`user:<secret>`).
 */
function base64Forms(secret: string): string[] {
  const forms: string[] = [];
  for (const text of [secret, `Bearer ${secret}`]) {
    const base64 = Buffer.from(text).toString("base64");
    for (const form of [base64, toBase64Url(base64)]) forms.push(form, form.replace(/=+$/, ""));
  }
  const bytes = Buffer.from(secret);
  for (let offset = 0; offset < 3; offset++) {
    const encoded = Buffer.concat([Buffer.alloc(offset), bytes]).toString("base64");
    // The groups of three bytes that hold only the secret's bytes.
    const first = offset === 0 ? 0 : 1;
    const last = Math.floor((offset + bytes.length) / 3);
    if (last - first < 2) continue;
    const core = encoded.slice(first * 4, last * 4);
    forms.push(core, toBase64Url(core));
  }
  return [...new Set(forms)].sort((a, b) => b.length - a.length);
}

/** Hides credentials in text, and in values before they are written as JSON. */
export class Redactor {
  readonly #literals = new Set<string>();
  readonly #patterns: RegExp[] = [];

  /** Adds `value` when it is a credential (`isSecretLike`); ignores anything else. */
  add(value: string | undefined): void {
    if (!value || !isSecretLike(value) || this.#literals.has(value)) return;
    this.#literals.add(value);
    for (const form of base64Forms(value)) this.#literals.add(form);
    this.#patterns.push(percentEncodedForms(value));
  }

  text(text: string): string {
    let out = [...this.#literals]
      .sort((a, b) => b.length - a.length)
      .reduce((current, literal) => current.split(literal).join(REDACTED), text);
    for (const pattern of this.#patterns) out = out.replace(pattern, REDACTED);
    return out;
  }

  /** `value` with every string in it redacted, keys included: still the same JSON shape. */
  value(value: unknown): unknown {
    if (typeof value === "string") return this.text(value);
    if (Array.isArray(value)) return value.map((item) => this.value(item));
    if (typeof value === "object" && value !== null) {
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [this.text(key), this.value(item)]),
      );
    }
    return value;
  }
}
