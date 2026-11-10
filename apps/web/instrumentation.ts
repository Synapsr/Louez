import { defineNodeInstrumentation } from 'evlog/next/instrumentation';


const evlogInstrumentation = defineNodeInstrumentation(
  () => import('./lib/evlog'),
);

export async function register() {
  await evlogInstrumentation.register();

  // Only run on the Node.js runtime (not Edge)
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // An error nothing caught, outside any request, reaches error tracking
    // (lib/error-tracking.ts). Next keeps its own listeners, which log and keep
    // the server up; these only report.
    const { reportServerError } = await import('./lib/error-tracking');
    process.on('unhandledRejection', (reason) => {
      reportServerError(reason, { source: 'process' });
    });
    process.on('uncaughtExceptionMonitor', (error) => {
      reportServerError(error, { source: 'process' });
    });

    // Warn when billing looks forgotten on the cloud. A log, never a reason to stop.
    await import('./lib/billing/startup-check')
      .then(({ reportBillingModeAtStartup }) => reportBillingModeAtStartup())
      .catch(() => undefined);

    // With platform billing, refuse to start without the hosting identity or, with the
    // billing service, on a wrong BILLING_* variable, like a failed migration (the checks
    // log why). Not during `next build`, which has no runtime secrets.
    if (process.env.NEXT_PHASE !== 'phase-production-build') {
      const { checkBillingSyncConfigAtStartup, checkHostingAtStartup } = await import(
        './lib/billing/startup-check'
      );
      const checks = [checkHostingAtStartup(), checkBillingSyncConfigAtStartup()];
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

export const onRequestError: typeof evlogInstrumentation.onRequestError = async (
  error,
  request,
  context,
) => {
  await evlogInstrumentation.onRequestError(error, request, context);
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  // The route as declared, never the requested path (it may hold a secret).
  const { reportServerError } = await import('./lib/error-tracking');
  reportServerError(error, {
    source: 'request',
    route: context.routePath,
    routeType: context.routeType,
  });
};
