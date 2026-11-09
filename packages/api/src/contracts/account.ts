import { z } from "zod";

/** The account's profile takes no argument: it is always the caller's own. */
export const getProfileInput = z.strictObject({});

/**
 * Who the connection acts for, for a client that keeps several accounts apart
 * (ChatGPT's profile tool): its contract takes `id`, and `name` only when
 * there is one, never null. No e-mail: the id tells accounts apart, the name
 * shows which one it is.
 */
export const getProfileOutput = z.strictObject({
  id: z.string().min(1).describe("The Louez account's id: stable, never reused."),
  name: z
    .string()
    .min(1)
    .optional()
    .describe("The name the user gave Louez; left out when they gave none."),
});
