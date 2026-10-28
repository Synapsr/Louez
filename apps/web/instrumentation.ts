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

    // With platform billing, refuse to start without the hosting identity, on a malformed
    // offer for new stores or, with the billing service, on a wrong BILLING_* variable,
    // like a failed migration (the checks log why). Not during `next build`, which has no
    // runtime secrets.
    if (process.env.NEXT_PHASE !== 'phase-production-build') {
      const {
        checkBillingSyncConfigAtStartup,
        checkHostingAtStartup,
        checkPayAsYouGoOfferAtStartup,
      } = await import('./lib/billing/startup-check');
      const checks = [
        checkHostingAtStartup(),
        checkPayAsYouGoOfferAtStartup(),
        checkBillingSyncConfigAtStartup(),
      ];
      if (checks.includes(false)) process.exit(1);
    }

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
