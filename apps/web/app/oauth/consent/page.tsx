import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { redirect } from "next/navigation";

import { AgentConsentCard } from "@/components/agent-connections/agent-consent-card";
import { auth } from "@/lib/auth";

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("agentConnections.consent");
  return { title: t("metaTitle"), robots: { index: false, follow: false } };
}

/** The signed query of the authorization server, as it sent it (repeated keys kept). */
const toQuery = (params: Record<string, string | string[] | undefined>): string => {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    for (const one of Array.isArray(value) ? value : value === undefined ? [] : [value]) {
      query.append(key, one);
    }
  }
  return query.toString();
};

/**
 * Where Better Auth sends a signed-in user to accept or refuse an MCP client
 * (`OAUTH_CONSENT_PAGE`). Everything shown comes from the signed query,
 * checked by the procedure; a visitor without a session signs in first and
 * comes back through the authorization endpoint.
 */
export default async function OAuthConsentPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const oauthQuery = toQuery(await searchParams);
  const session = await auth();
  if (!session?.user) redirect(`/login?${oauthQuery}`);

  return <AgentConsentCard oauthQuery={oauthQuery} />;
}
