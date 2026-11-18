/**
 * Checks the Google Ads conversion upload's configuration against Google, without
 * recording anything: one sample conversion sent with `validateOnly`, which Google
 * validates and does not execute (docs/analytics/lifecycle.md). Run it with the
 * production variables before turning the upload on:
 *
 *   infisical run --env=prod -- pnpm --filter @louez/web google-ads:check
 *
 * It prints the configuration's problem, Google's refusal, or "ok". Never a secret.
 */
import { resolve } from "node:path";

import { config } from "dotenv";

const appRoot = process.cwd();
config({ path: resolve(appRoot, ".env.local"), quiet: true });
config({ path: resolve(appRoot, ".env"), quiet: true });

async function main() {
  const [{ readGoogleAdsConversionsConfig }, { createDataManagerClient }] = await Promise.all([
    import("../lib/acquisition/google-ads-config"),
    import("../lib/acquisition/google-data-manager"),
  ]);
  // The flag is not needed for a check: the upload may still be off.
  const result = readGoogleAdsConversionsConfig({
    ...process.env,
    GOOGLE_ADS_CONVERSIONS_ENABLED: "true",
  });
  if (!result.enabled) {
    console.error(`Not configured: ${result.reason}`);
    return 1;
  }
  const { customerId, conversionActionId, loginCustomerId, serviceAccount } = result.config;
  console.log(
    `Customer ${customerId}, conversion action ${conversionActionId}` +
      `${loginCustomerId ? `, through manager ${loginCustomerId}` : ""}, as ${serviceAccount.clientEmail}`,
  );
  await createDataManagerClient(result.config).ingest(
    {
      userId: "louez-configuration-check",
      clickIdType: "gclid",
      clickId: "louez-configuration-check",
      convertedAt: new Date(),
      adUserDataConsent: "denied",
      adPersonalizationConsent: "denied",
    },
    { validateOnly: true },
  );
  console.log("ok: Google accepted the request (validateOnly, nothing recorded)");
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
