import {
  clientIconOrigin,
  createSiteIconCache,
  type SiteIcon,
} from "@louez/auth/oauth-client-icon";
import { db, oauthClients } from "@louez/db";
import { eq } from "drizzle-orm";

/**
 * The website icon of an OAuth client, for the consent page and the
 * "Agents connectés" list (`AgentClient.iconUrl`). Only for a client from a
 * metadata document (CIMD), whose host is proven: the icon is that host's,
 * at the origin of the stored client id, never a URL from the request nor
 * the logo the client declares. Icons are kept in memory, by origin.
 */

const siteIcon = createSiteIconCache();

/** The icon of `clientId`, or null when it has none to show. */
export async function loadAgentClientIcon(
  clientId: string,
  lookup: (origin: string) => Promise<SiteIcon | null> = siteIcon,
): Promise<SiteIcon | null> {
  const [row] = await db
    .select({
      clientId: oauthClients.clientId,
      clientDiscoveryId: oauthClients.clientDiscoveryId,
      disabled: oauthClients.disabled,
    })
    .from(oauthClients)
    .where(eq(oauthClients.clientId, clientId))
    .limit(1);
  if (!row || row.disabled || row.clientDiscoveryId === null) return null;
  const origin = clientIconOrigin(row.clientId);
  return origin ? lookup(origin) : null;
}
