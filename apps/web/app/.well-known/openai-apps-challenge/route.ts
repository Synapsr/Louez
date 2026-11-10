import { connection } from "next/server";

import { env } from "@/env";
import { openAiAppsChallengeResponse } from "@/lib/openai-apps-challenge";

// OpenAI's domain check for the Louez plugin (docs/architecture/api-and-agents.md).
// connection() keeps the answer out of the build's prerender, so a token set or
// changed in the deployment's env is served without a rebuild.
export async function GET() {
  await connection();
  return openAiAppsChallengeResponse(env.OPENAI_APPS_CHALLENGE);
}
