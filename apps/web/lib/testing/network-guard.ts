import net from "node:net";
import { after, afterEach, before, beforeEach } from "node:test";

/**
 * Closes the network to the tests of a suite: every socket that would connect to
 * another host than this machine (the test database, a local server) is refused
 * before it connects, and the test that opened it fails, naming the host. It
 * hooks `net.Socket.prototype.connect`, through which `fetch`, `http`, `https`,
 * Stripe's client, mail and every other provider's client open their sockets.
 *
 * `reportOnly` names tests that are known to reach out: their attempts are
 * refused and kept in `attempts`, and they do not fail, so a change that makes
 * another test reach out fails it.
 */
export function closeNetworkForSuite({
  reportOnly = new Set<string>(),
}: { reportOnly?: ReadonlySet<string> } = {}) {
  const attempts: Array<{ test: string; host: string; port: number | undefined }> = [];
  const original = net.Socket.prototype.connect;
  let current = OUTSIDE_A_TEST;
  let failures: string[] = [];

  before(() => {
    net.Socket.prototype.connect = function guardedConnect(this: net.Socket, ...args: unknown[]) {
      const target = connectTarget(args);
      if (target && !isThisMachine(target.host)) {
        attempts.push({ test: current, ...target });
        if (!reportOnly.has(current)) failures.push(`${target.host}:${target.port ?? ""}`);
        const refusal = new Error(
          `Network closed to tests: "${current}" tried to reach ${target.host}:${target.port ?? ""}`,
        );
        process.nextTick(() => this.destroy(refusal));
        return this;
      }
      return Reflect.apply(original, this, args) as net.Socket;
    } as typeof net.Socket.prototype.connect;
  });
  after(async () => {
    // A request a test started and did not await may open its socket later.
    await new Promise((resolve) => setImmediate(resolve));
    net.Socket.prototype.connect = original;
    const outside = attempts.filter(({ test }) => test === OUTSIDE_A_TEST);
    if (outside.length > 0) {
      throw new Error(
        `The suite reached the network outside a test: ${outside.map(({ host }) => host).join(", ")}`,
      );
    }
  });
  beforeEach((context) => {
    current = context.name;
    failures = [];
  });
  afterEach(() => {
    const reached = failures;
    current = OUTSIDE_A_TEST;
    failures = [];
    if (reached.length > 0) {
      throw new Error(`The test reached the network: ${reached.join(", ")}`);
    }
  });
  return { attempts };
}

const OUTSIDE_A_TEST = "(outside a test)";

/** The settings that turn on a sender to a provider: mail, SMS, the platform's Discord. */
const PROVIDER_SETTINGS = [
  "SMTP_HOST",
  "SMTP_USER",
  "SMTP_PASSWORD",
  "SMTP_FROM",
  "SMS_PARTNER_API_KEY",
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "DISCORD_ADMIN_WEBHOOK_URL",
  "NEXT_PUBLIC_POSTHOG_KEY",
];

/**
 * Leaves the providers' senders unconfigured, whatever this machine's settings,
 * for a suite whose code under test runs them for real: each refuses before it
 * opens a socket. Set to empty, not deleted, so an env file loaded later does
 * not set them again. Call it before the modules under test load.
 */
export function withoutProviderSettings() {
  for (const name of PROVIDER_SETTINGS) process.env[name] = "";
}

/** The host and port a `connect` call names; none for a local socket path. */
function connectTarget(args: unknown[]): { host: string; port: number | undefined } | null {
  const [first, second] = args;
  if (Array.isArray(first)) return connectTarget(first);
  if (typeof first === "object" && first !== null) {
    const options = first as { host?: string | null; port?: number | string; path?: unknown };
    // A local socket path; `https` passes `path: null` with a host.
    if (typeof options.path === "string" && options.path.length > 0) return null;
    return { host: options.host || "localhost", port: Number(options.port) || undefined };
  }
  if (typeof first === "number" || (typeof first === "string" && /^\d+$/.test(first))) {
    return { host: typeof second === "string" ? second : "localhost", port: Number(first) };
  }
  // A string that is not a port is a local socket path.
  return null;
}

function isThisMachine(host: string): boolean {
  return ["localhost", "127.0.0.1", "::1", "0.0.0.0"].includes(host) || host.startsWith("127.");
}
