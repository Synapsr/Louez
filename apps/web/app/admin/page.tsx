import { connection } from 'next/server';
import { redirect } from 'next/navigation';
import { requirePlatformBilling } from '@/lib/billing/require-billing';

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

/** Admin home → the finance overview (the only admin section for now). */
export default async function AdminIndexPage() {
  // Read LOUEZ_BILLING at request time: before a dynamic API, Cache Components
  // would run this check during the build, which has no LOUEZ_BILLING, and serve a 404.
  await connection();
  requirePlatformBilling();
  redirect('/admin/finance');
}
