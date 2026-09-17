import { z } from "zod";

const originSchema = z
  .url({ protocol: /^https?$/ })
  .pipe(z.string().refine((value) => new URL(value).origin === value));

export function marketingOrigins(appUrl: string, extraOrigins: string[] = []): string[] {
  const host = new URL(appUrl).hostname;
  const defaults =
    host === "app.louez.io"
      ? ["https://louez.io", "https://www.louez.io"]
      : host === "app.louez.app"
        ? ["https://louez.app", "https://www.louez.app"]
        : [];
  return [...defaults, ...extraOrigins];
}

export async function marketingSessionResponse(
  request: Request,
  allowedOrigins: string[],
  readAuthenticated: () => Promise<boolean>,
  onError: () => void,
): Promise<Response> {
  const headers = new Headers({
    "Cache-Control": "private, no-store",
    Vary: "Origin",
  });
  const origin = originSchema.safeParse(request.headers.get("origin"));
  if (!origin.success || !allowedOrigins.includes(origin.data)) {
    return new Response(null, { status: 403, headers });
  }
  headers.set("Access-Control-Allow-Origin", origin.data);
  headers.set("Access-Control-Allow-Credentials", "true");
  headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }
  try {
    const authenticated = await readAuthenticated();
    return Response.json({ authenticated }, { headers });
  } catch {
    onError();
    return Response.json({ error: "session_unavailable" }, { status: 503, headers });
  }
}
