import { redirect } from 'next/navigation';

import { NextIntlClientProvider } from 'next-intl';
import { getMessages } from 'next-intl/server';

import { FromHelloProvider } from '@/components/fromhello-provider';
import { GleapProvider } from '@/components/dashboard/gleap-provider';
import { PostHogProvider } from '@/components/posthog-provider';
import { ThemeProvider } from '@/components/theme-provider';

import { auth } from '@/lib/auth';
import { getCurrentStore } from '@/lib/store-context';
import { getCurrentPlanSlug } from '@/lib/stripe/subscriptions';

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  // Redirect to login if not authenticated
  if (!session?.user) {
    redirect('/login');
  }

  const store = await getCurrentStore();
  const planSlug = store ? await getCurrentPlanSlug(store.id) : null;
  const messages = await getMessages();

  return (
    <NextIntlClientProvider messages={messages}>
      <PostHogProvider
        user={
          session.user?.id && session.user?.email
            ? {
                id: session.user.id,
                email: session.user.email,
                name: session.user.name,
              }
            : undefined
        }
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <FromHelloProvider
            user={
              session.user?.id && session.user?.email
                ? {
                    id: session.user.id,
                    email: session.user.email,
                    name: session.user.name,
                  }
                : undefined
            }
            store={
              store
                ? {
                    name: store.name,
                    slug: store.slug,
                    phone: store.phone,
                    email: store.email,
                    plan: planSlug,
                  }
                : undefined
            }
          />
          <GleapProvider
            user={
              session.user?.id && session.user?.email
                ? {
                    id: session.user.id,
                    email: session.user.email,
                    name: session.user.name,
                  }
                : undefined
            }
            store={
              store
                ? {
                    id: store.id,
                    name: store.name,
                  }
                : undefined
            }
          >
            <div className="bg-background min-h-screen">{children}</div>
          </GleapProvider>
        </ThemeProvider>
      </PostHogProvider>
    </NextIntlClientProvider>
  );
}
