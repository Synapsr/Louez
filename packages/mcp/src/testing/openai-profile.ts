import { AjvJsonSchemaValidator } from "@modelcontextprotocol/client/validators/ajv";

/**
 * The profile ChatGPT reads from a tool marked `_meta["openai/profile"]`, as
 * its Apps SDK guide publishes it (Authentication, "Profile tool"): a
 * non-empty `id`, and optional display fields, nothing else. A field it does
 * not know, or a null, is refused.
 */
export const OPENAI_PROFILE_SCHEMA = {
  type: "object",
  properties: {
    id: { type: "string", minLength: 1 },
    name: { type: "string" },
    email: { type: "string" },
    nickname: { type: "string" },
  },
  required: ["id"],
  additionalProperties: false,
} as const;

const validator = new AjvJsonSchemaValidator();

/** Why `value` is not a profile ChatGPT takes; null when it is one. */
export function openAiProfileProblem(value: unknown): string | null {
  const result = validator.getValidator(OPENAI_PROFILE_SCHEMA)(value);
  return result.valid ? null : (result.errorMessage ?? "invalid profile");
}
