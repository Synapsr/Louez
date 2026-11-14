/**
 * Where the sample approvals script may write: stricter than the other seed
 * scripts' guard (`validateEnvironment`), as it writes a credential row and
 * approvals. It runs only on a database on this machine, and only when its
 * command says it knows it writes sample data. Checked before anything
 * connects to the database; what it checked is what the script connects
 * with (`SampleConnection`), never the URL itself, whose query could name
 * another host or socket for the driver.
 */

/** The flag that says the person running the script knows it writes sample data. */
export const WRITE_SAMPLES_FLAG = "--write-sample-data";

/** The hosts of a database on this machine; anything else may be someone's real data. */
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** What the script connects with: these fields, read from the URL the guard checked, and nothing else. */
export interface SampleConnection {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

export type SampleDatabaseVerdict =
  | { ok: true; connection: SampleConnection }
  | { ok: false; reason: string };

/**
 * Whether the script may write to `databaseUrl`, and with what. A URL with
 * any query string or fragment is refused, an empty one included: the
 * driver reads options there (`host`, `socketPath`) that replace what the
 * host part says.
 */
export function checkSampleDatabase(input: {
  databaseUrl: string | undefined;
  nodeEnv: string | undefined;
  flagged: boolean;
}): SampleDatabaseVerdict {
  const refuse = (reason: string) => ({ ok: false, reason }) as const;
  if (input.nodeEnv === "production") {
    return refuse("NODE_ENV is production: the sample approvals are never written there.");
  }
  const raw = input.databaseUrl;
  if (!raw) return refuse("DATABASE_URL is not set.");
  if (raw.includes("?") || raw.includes("#")) {
    return refuse(
      "DATABASE_URL has a query string or a fragment, whose options can send the connection elsewhere: give it as mysql://user:password@host:port/database, nothing after.",
    );
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return refuse("DATABASE_URL is not a URL this script can read.");
  }
  if (url.protocol !== "mysql:") return refuse("DATABASE_URL is not a mysql:// URL.");
  const host = url.hostname.toLowerCase();
  if (!LOOPBACK_HOSTS.has(host)) {
    return refuse(
      `DATABASE_URL points at ${host || "no host"}, not at this machine (localhost, 127.0.0.1 or ::1): the sample approvals are written to a local database only.`,
    );
  }
  const port = url.port === "" ? 3306 : Number(url.port);
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (database === "" || database.includes("/")) {
    return refuse("DATABASE_URL names no database, or more than one path segment.");
  }
  if (!input.flagged) {
    return refuse(
      `It writes an API key and three approvals to the database at ${host}: run it again with ${WRITE_SAMPLES_FLAG} to say you know.`,
    );
  }
  return {
    ok: true,
    connection: {
      // mysql2 takes an IPv6 address without its brackets.
      host: host === "[::1]" ? "::1" : host,
      port,
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      database,
    },
  };
}
