/**
 * Next.js Instrumentation
 *
 * This file is executed once when the Next.js server starts.
 * It's used to perform initialization tasks like database setup.
 *
 * @see https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */

export async function register() {
  // Only run on the Node.js runtime (not Edge)
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // Only run database setup in production or when explicitly enabled
    // This prevents running during builds or when not needed
    const shouldSetup =
      process.env.NODE_ENV === 'production' || process.env.AUTO_DB_SETUP === 'true'

    if (shouldSetup) {
      const { setupDatabase } = await import('@louez/db')
      await setupDatabase()
    }
  }
}
