import { defineNodeInstrumentation } from 'evlog/next/instrumentation';


const evlogInstrumentation = defineNodeInstrumentation(
  () => import('./lib/evlog'),
);

export async function register() {
  await evlogInstrumentation.register();

  // Only run on the Node.js runtime (not Edge)
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Warn when billing looks forgotten on the cloud. A log, never a reason to stop.
    await import('./lib/billing/startup-check')
      .then(({ reportBillingModeAtStartup }) => reportBillingModeAtStartup())
      .catch(() => undefined);

    // Only run database setup in production or when explicitly enabled
    // This prevents running during builds or when not needed
    const shouldSetup =
      process.env.NODE_ENV === 'production' ||
      process.env.AUTO_DB_SETUP === 'true';

    if (shouldSetup) {
      const { setupDatabase } = await import('@louez/db');
      await setupDatabase();

      // Lock the pricing of legacy stores that followed PAYG_DEFAULT_PRICING live, before
      // the first request reads it. Fails closed like a failed migration (the step logs why).
      // Only an instance that bills its stores has pricing to lock.
      const { isBillingEnabled } = await import('./lib/billing/mode');
      if (isBillingEnabled()) {
        const { freezeLegacyPricingAtStartup } = await import(
          './lib/pay-as-you-go/pricing-lock-startup'
        );
        await freezeLegacyPricingAtStartup().catch(() => process.exit(1));
      }
    }
  }
}

export const onRequestError = evlogInstrumentation.onRequestError;
