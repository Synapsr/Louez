import { redirect } from 'next/navigation';

import { NextIntlClientProvider } from 'next-intl';
import { getMessages } from 'next-intl/server';

import { PostHogProvider } from '@/components/posthog-provider';
import { ThemeProvider } from '@/components/theme-provider';

import { auth } from '@/lib/auth';
import { isCurrentUserPlatformAdmin } from '@/lib/platform-admin';

import { AdminHeader } from './_components/header';

/**
 * Platform-admin area, served OUTSIDE the per-store dashboard. This layout is the
 * security boundary for everything under /admin: it runs server-side on every request
 * and redirects anyone who is not an authenticated platform admin. Pages below re-check
 * as defense-in-depth, but this guard is what makes the area safe.
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  if (!session?.user?.id) {
    redirect('/login');
  }

  // Hard gate: only platform admins may reach any /admin route.
  const isAdmin = await isCurrentUserPlatformAdmin();
  if (!isAdmin) {
    redirect('/dashboard');
  }

  const messages = await getMessages();

  return (
    <NextIntlClientProvider messages={messages}>
      <PostHogProvider
        user={{
          id: session.user.id,
          email: session.user.email || '',
          name: session.user.name,
        }}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <div className="bg-muted/30 min-h-screen">
            <AdminHeader
              userEmail={session.user.email || ''}
              userImage={session.user.image}
            />
            <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
              {children}
            </main>
          </div>
        </ThemeProvider>
      </PostHogProvider>
    </NextIntlClientProvider>
  );
}
