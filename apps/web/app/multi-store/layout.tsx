import { redirect } from 'next/navigation';

import { NextIntlClientProvider } from 'next-intl';
import { getMessages } from 'next-intl/server';

import { PostHogProvider } from '@/components/posthog-provider';
import { ThemeProvider } from '@/components/theme-provider';

import { auth } from '@/lib/auth';
import { getUserStores } from '@/lib/store-context';

import { MultiStoreHeader } from './_components/header';

export default async function MultiStoreLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  if (!session?.user?.id) {
    redirect('/login');
  }

  const stores = await getUserStores();

  if (stores.length < 2) {
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
            <MultiStoreHeader
              stores={stores}
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
