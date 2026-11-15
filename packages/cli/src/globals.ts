/** The flags every command takes, beside an operation's own. */
export const GLOBAL_FLAGS = {
  "api-key": {
    value: "<key>",
    description:
      "The API key (lz_…), for this command only. Other users can see it in the list of processes, and your shell keeps it in its history: prefer LOUEZ_API_KEY, or `louez auth login`, which reads the key from standard input or asks for it. Default: LOUEZ_API_KEY, then the key `louez auth login` saved.",
  },
  "api-url": {
    value: "<url>",
    description:
      "The API's base URL. Default: LOUEZ_API_URL, then the URL `louez auth login` saved the key with, then https://app.louez.io/api/v1. The saved key is sent to the origin it was saved for only.",
  },
  insecure: {
    value: null,
    description:
      "Allow an http:// base URL on a host other than localhost, 127.0.0.1 or *.localify.",
  },
  json: {
    value: "<body>",
    description:
      "The whole request body as JSON (the query of a GET): inline, @file to read a file, or - to read standard input. Flags set fields over it.",
  },
  confirmation: {
    value: "<id>",
    description:
      "Sends Louez-Confirmation: the token a CONFIRMATION_REQUIRED answer gave, or the id of an approval a person approved.",
  },
  wait: {
    value: null,
    description:
      "When the write needs a person's approval, wait for their decision, then carry it out once approved.",
  },
  "idempotency-key": {
    value: "<key>",
    description:
      "Sends Idempotency-Key. A write without one gets a new key, printed only when the network fails.",
  },
  timeout: {
    value: "<seconds>",
    description: "How long to wait for each answer. Default: 120.",
  },
  help: { value: null, description: "Show help." },
  version: { value: null, description: "Show the CLI's version." },
} as const satisfies Record<string, { value: string | null; description: string }>;

type GlobalFlag = keyof typeof GLOBAL_FLAGS;

export function isGlobalFlag(flag: string): flag is GlobalFlag {
  return Object.hasOwn(GLOBAL_FLAGS, flag);
}

/** The first words that are commands of their own, never an operation's group. */
export const BUILT_IN_COMMANDS = ["api", "auth", "help"] as const;
