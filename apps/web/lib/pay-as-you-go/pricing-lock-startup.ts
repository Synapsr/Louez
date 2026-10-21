import mysql from 'mysql2/promise';

import { env as dbEnv } from '@louez/db/env';

import { log } from '@/lib/evlog';

import { getLegacyPricingTerms } from './defaults';
import {
  applyLegacyPricingFreeze,
  isEmptyFreezePlan,
  planLegacyPricingFreeze,
} from './pricing-lock';

/**
 * Server-start step, run right after the database migrations. It writes this deployment's
 * env offer onto the stores that never had frozen pricing (legacy rows that followed
 * PAYG_DEFAULT_PRICING live, and stores without a subscription row), tags rows that only
 * lack a pricing version, and spells out stored configs in full. New code always writes
 * frozen pricing, so after the first start of this version this finds nothing and never
 * reads the env. Logs and rethrows on failure so the caller stops the server, like a
 * failed migration. Uses its own connection, closed at the end.
 */
export async function freezeLegacyPricingAtStartup(): Promise<void> {
  // Same rule as setupDatabase: without a database there is nothing to set up.
  if (!dbEnv.DATABASE_URL) return;

  let connection: mysql.Connection | null = null;
  try {
    connection = await mysql.createConnection(dbEnv.DATABASE_URL);
    const plan = await planLegacyPricingFreeze(connection, 'startup');
    if (isEmptyFreezePlan(plan)) return;

    const terms = getLegacyPricingTerms();
    const result = await applyLegacyPricingFreeze(connection, plan, terms);
    log.info(
      'billing',
      `pricing lock: froze ${result.frozen} row(s) and created ${result.created} with ${JSON.stringify(terms)}, tagged ${result.tagged}, spelled out ${result.normalized} stored config(s)`,
    );
  } catch (error) {
    log.error(
      'billing',
      `pricing lock failed, stopping: ${error instanceof Error ? error.message : String(error)}`,
    );
    throw error;
  } finally {
    await connection?.end();
  }
}
