import { resolve } from "node:path";

import { config } from "dotenv";

const appRoot = process.cwd();
const repositoryRoot = resolve(appRoot, "../..");
config({ path: resolve(appRoot, ".env.local"), quiet: true });
config({ path: resolve(appRoot, ".env"), quiet: true });
config({ path: resolve(repositoryRoot, ".env.local"), quiet: true });
config({ path: resolve(repositoryRoot, ".env"), quiet: true });

async function main() {
  const [{ runMarketplaceDefaultPublication }, { env }] = await Promise.all([
    import("@louez/api/services/marketplace-default-publication"),
    import("../env"),
  ]);

  const result = await runMarketplaceDefaultPublication({
    enabled: env.MARKETPLACE_DEFAULT_PUBLICATION_ENABLED,
    launchCohortSize: env.REEENT_LAUNCH_COHORT_SIZE,
  });

  console.log(JSON.stringify(result, null, 2));
  return result.errors.length > 0 ? 1 : 0;
}

main()
  .then((code) => {
    // The imported service keeps the shared DB pool open, which would keep the
    // event loop alive forever; exit explicitly once the result is printed.
    process.exit(code);
  })
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });
