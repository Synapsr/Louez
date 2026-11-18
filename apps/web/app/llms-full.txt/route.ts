import { respondWithLlmsTxt } from "@/lib/ai-visibility/llms-txt.route";

/** The storefront's llms-full.txt: llms.txt with every product's description. */
export function GET(): Promise<Response> {
  return respondWithLlmsTxt(true);
}
