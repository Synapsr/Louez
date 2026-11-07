import { loadAgentClientIcon } from "@louez/api/services/agent-client-icons";
import { z } from "zod";

import { auth } from "@/lib/auth";

// The website icon of a CIMD OAuth client, for the consent page and the
// "Agents connectés" list (`AgentClient.iconUrl`). A plain route, not a
// procedure: it answers image bytes to an <img>, not JSON, and is no user
// action. Louez fetches the icon and serves it from its own origin, so the
// app's CSP keeps other sites' images out. Signed-in users only.

const querySchema = z.object({ client_id: z.string().min(1).max(2048) });

const ICON_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'",
};

const missing = (status: 400 | 401 | 404) =>
  new Response(null, {
    status,
    headers: {
      ...ICON_HEADERS,
      // A missing icon is asked again in an hour at most; the rest never.
      "Cache-Control": status === 404 ? "private, max-age=3600" : "no-store",
    },
  });

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user) return missing(401);

  const query = querySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams.entries()),
  );
  if (!query.success) return missing(400);

  const icon = await loadAgentClientIcon(query.data.client_id);
  if (!icon) return missing(404);

  return new Response(Buffer.from(icon.body), {
    headers: {
      ...ICON_HEADERS,
      "Content-Type": icon.contentType,
      "Content-Length": String(icon.body.byteLength),
      "Cache-Control": "private, max-age=86400",
    },
  });
}
