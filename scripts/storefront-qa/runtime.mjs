import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

export const sourceRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
export const stateDir = path.join(sourceRoot, ".agent-docs/storefront-qa");
export const snapshotDir = path.join(stateDir, "source");
export const domain = "louez-qa.localify";

export function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: sourceRoot, stdio: "inherit", ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with ${result.status}`);
  return result.stdout?.toString().trim();
}

export function readState() {
  const state = JSON.parse(readFileSync(path.join(stateDir, "state.json"), "utf8"));
  if (state.kind !== "louez-storefront-qa-v1" || state.sourceRoot !== sourceRoot) {
    throw new Error("Invalid QA environment ownership marker");
  }
  return state;
}

// Tooling boundary: only these host variables may reach the isolated application.
export function cleanEnv() {
  return Object.fromEntries(
    [
      "PATH",
      "HOME",
      "TMPDIR",
      "SHELL",
      "LANG",
      "TERM",
      "NODE_EXTRA_CA_CERTS",
      "SSL_CERT_FILE",
      "PNPM_HOME",
    ].flatMap((key) => (process.env[key] ? [[key, process.env[key]]] : [])),
  );
}

export function appEnv(state) {
  return {
    ...cleanEnv(),
    NODE_ENV: "development",
    LOUEZ_MODE: "platform",
    DATABASE_URL: `mysql://storefront_qa:${state.dbPassword}@127.0.0.1:${state.dbPort}/louez_storefront_qa`,
    AUTH_SECRET: state.authSecret,
    AUTH_URL: `https://app.${domain}`,
    AUTH_TRUST_HOST: "true",
    NEXT_PUBLIC_APP_URL: `https://${domain}`,
    NEXT_PUBLIC_APP_DOMAIN: domain,
    NEXT_PUBLIC_DASHBOARD_SUBDOMAIN: "app",
    SMTP_HOST: "127.0.0.1",
    SMTP_PORT: String(state.smtpPort),
    SMTP_SECURE: "false",
    SMTP_USER: "storefront-qa",
    SMTP_PASSWORD: "local-qa-only",
    SMTP_FROM: "Recette Louez <recette@example.test>",
    DEV_EMAIL_ALLOWLIST: "@example.test",
    S3_ENDPOINT: `http://127.0.0.1:${state.storagePort}`,
    S3_REGION: "us-east-1",
    S3_BUCKET: "storefront-qa",
    S3_ACCESS_KEY_ID: "storefront-qa",
    S3_SECRET_ACCESS_KEY: state.storagePassword,
    S3_PUBLIC_URL: "/files",
    TULIP_API_KEY: "local-qa-simulation",
    TULIP_API_BASE_URL: `http://127.0.0.1:${state.fixturePort}/tulip`,
    GOOGLE_PLACES_API_KEY: "local-qa-simulation",
    STRIPE_SECRET_KEY: "sk_test_local_qa_simulation",
    PLATFORM_ADMIN_EMAILS: "owner@example.test",
    INTEGRATION_ENCRYPTION_KEY: Buffer.from(state.encryptionKey, "hex").toString("base64url"),
    AUTO_DB_SETUP: "false",
    MARKETPLACE_DEFAULT_PUBLICATION_ENABLED: "false",
    AI_CREDITS_ENABLED: "false",
  };
}
