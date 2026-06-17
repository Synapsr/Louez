import { redirect } from 'next/navigation';

/** Admin home → the finance overview (the only admin section for now). */
export default function AdminIndexPage() {
  redirect('/admin/finance');
}
