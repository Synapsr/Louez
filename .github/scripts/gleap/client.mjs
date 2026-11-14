/**
 * A thin client for the Gleap admin REST API (https://docs.gleap.ai/en/articles/716-api-overview).
 * Every call needs GLEAP_API_KEY and GLEAP_PROJECT_ID. With DRY_RUN set to
 * anything but "false", writes are printed instead of sent, so a first run
 * shows what would change without touching the project.
 */

const API = process.env.GLEAP_API_URL ?? "https://api.gleap.io/v3";

export const dryRun = process.env.DRY_RUN !== "false";

export function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

export async function gleap(method, path, body) {
  const write = method !== "GET";
  if (write && dryRun) {
    console.log(`[dry run] ${method} ${path}`, body ? JSON.stringify(body).slice(0, 400) : "");
    return null;
  }
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${requireEnv("GLEAP_API_KEY")}`,
      Project: requireEnv("GLEAP_PROJECT_ID"),
      "Content-Type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) {
    throw new Error(
      `Gleap ${method} ${path} answered ${response.status}: ${await response.text()}`,
    );
  }
  return response.status === 204 ? null : response.json();
}
