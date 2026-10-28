import { redirect } from 'next/navigation';
import { requirePlatformBilling } from '@/lib/billing/require-billing';

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

/** Admin home → the finance overview (the only admin section for now). */
export default function AdminIndexPage() {
  requirePlatformBilling();
  redirect('/admin/finance');
}
