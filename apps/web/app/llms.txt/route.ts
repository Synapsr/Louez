import { respondWithLlmsTxt } from "@/lib/ai-visibility/llms-txt.route";

/** The storefront's llms.txt: the store, its rules and its products with their rates. */
export function GET(): Promise<Response> {
  return respondWithLlmsTxt(false);
}
