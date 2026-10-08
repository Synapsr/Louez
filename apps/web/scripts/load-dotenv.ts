// Imported first by the maintenance scripts so that `.env` files are loaded
// before `@louez/db` reads DATABASE_URL at import time.
import { resolve } from "node:path";

import { config } from "dotenv";

const appRoot = process.cwd();
const repositoryRoot = resolve(appRoot, "../..");
config({ path: resolve(appRoot, ".env.local"), quiet: true });
config({ path: resolve(appRoot, ".env"), quiet: true });
config({ path: resolve(repositoryRoot, ".env.local"), quiet: true });
config({ path: resolve(repositoryRoot, ".env"), quiet: true });
