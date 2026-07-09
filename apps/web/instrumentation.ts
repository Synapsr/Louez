import { defineNodeInstrumentation } from 'evlog/next/instrumentation';


const evlogInstrumentation = defineNodeInstrumentation(
  () => import('./lib/evlog'),
);

export async function register() {
  await evlogInstrumentation.register();

  // Only run on the Node.js runtime (not Edge)
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Only run database setup in production or when explicitly enabled
    // This prevents running during builds or when not needed
    const shouldSetup =
      process.env.NODE_ENV === 'production' ||
      process.env.AUTO_DB_SETUP === 'true';

    if (shouldSetup) {
      const { setupDatabase } = await import('@louez/db');
      await setupDatabase();
    }
  }
}

export const onRequestError = evlogInstrumentation.onRequestError;
