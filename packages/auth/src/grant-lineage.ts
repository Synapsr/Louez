import { apiAgentGrants, db } from "@louez/db";
import { and, eq } from "drizzle-orm";

/**
 * What the OAuth provider asks Louez about grants (see `mcpOAuthPlugins`):
 * which grant a new token lineage starts under, and whether a lineage's grant
 * still exists. A token lineage is tied to its grant by its `reference_id`, a
 * foreign key with cascade, so these reads only refuse early what the database
 * would refuse anyway.
 */

/** The grant a user has now for an OAuth client: where a new token lineage starts. */
export async function currentGrantId(input: { userId: string; clientId: string }) {
  const [grant] = await db
    .select({ id: apiAgentGrants.id })
    .from(apiAgentGrants)
    .where(
      and(eq(apiAgentGrants.userId, input.userId), eq(apiAgentGrants.clientId, input.clientId)),
    )
    .limit(1);
  return grant?.id ?? null;
}

/** Whether a lineage's grant still exists for its user and client. */
export async function isGrantActive(input: { grantId: string; userId: string; clientId: string }) {
  const [grant] = await db
    .select({ id: apiAgentGrants.id })
    .from(apiAgentGrants)
    .where(
      and(
        eq(apiAgentGrants.id, input.grantId),
        eq(apiAgentGrants.userId, input.userId),
        eq(apiAgentGrants.clientId, input.clientId),
      ),
    )
    .limit(1);
  return Boolean(grant);
}
