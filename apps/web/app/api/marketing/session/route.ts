import { env } from "@/env";
import { authInstance } from "@/lib/auth";
import { log } from "@/lib/evlog";
import { marketingOrigins, marketingSessionResponse } from "@/lib/marketing-session";

function handleSession(request: Request): Promise<Response> {
  return marketingSessionResponse(
    request,
    marketingOrigins(env.AUTH_URL, env.MARKETING_WEBSITE_ORIGINS),
    async () => {
      const session = await authInstance.api.getSession({
        headers: request.headers,
        query: { disableCookieCache: true, disableRefresh: true },
      });
      return Boolean(session);
    },
    () => log.error({ action: "marketing_session_check", message: "Session lookup failed" }),
  );
}

export const GET = handleSession;
export const OPTIONS = handleSession;
