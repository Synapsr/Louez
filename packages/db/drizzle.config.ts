import 'dotenv/config'
import { defineConfig } from 'drizzle-kit'

import {
  BILLING_SERVICE_MIGRATIONS_TABLE,
  BILLING_SERVICE_TABLE_PREFIX,
} from './src/billing-service-tables'

export default defineConfig({
  schema: './src/schema.ts',
  out: './src/migrations',
  dialect: 'mysql',
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  // The billing service keeps its tables in the cloud database: push must never drop them.
  tablesFilter: [`!${BILLING_SERVICE_TABLE_PREFIX}*`, `!${BILLING_SERVICE_MIGRATIONS_TABLE}`],
  verbose: true,
  strict: true,
})
