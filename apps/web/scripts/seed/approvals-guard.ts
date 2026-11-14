/**
 * Where the sample approvals script may write: stricter than the other seed
 * scripts' guard (`validateEnvironment`), as it writes a credential row and
 * approvals. It runs only on a database on this machine, and only when its
 * command says it knows it writes sample data. Checked before anything
 * connects to the database.
 */

/** The flag that says the person running the script knows it writes sample data. */
export const WRITE_SAMPLES_FLAG = "--write-sample-data";

/** The hosts of a database on this machine; anything else may be someone's real data. */
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/** Why the script must not write to this database, or null when it may. */
export function sampleDataRefusal(input: {
  databaseUrl: string | undefined;
  nodeEnv: string | undefined;
  flagged: boolean;
}): string | null {
  if (input.nodeEnv === "production") {
    return "NODE_ENV is production: the sample approvals are never written there.";
  }
  if (!input.databaseUrl) return "DATABASE_URL is not set.";
  let host: string;
  try {
    host = new URL(input.databaseUrl).hostname.toLowerCase();
  } catch {
    return "DATABASE_URL is not a URL this script can read.";
  }
  if (!LOOPBACK_HOSTS.has(host)) {
    return `DATABASE_URL points at ${host || "no host"}, not at this machine (localhost, 127.0.0.1 or ::1): the sample approvals are written to a local database only.`;
  }
  if (!input.flagged) {
    return `It writes an API key and three approvals to the database at ${host}: run it again with ${WRITE_SAMPLES_FLAG} to say you know.`;
  }
  return null;
}
