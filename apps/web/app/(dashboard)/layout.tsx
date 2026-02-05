import { NextIntlClientProvider } from 'next-intl'
import { getMessages } from 'next-intl/server'
import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { getCurrentStore } from '@/lib/store-context'
import { Toaster } from '@louez/ui'
import { ThemeProvider } from '@/components/theme-provider'
import { PostHogProvider } from '@/components/posthog-provider'
import { GleapProvider } from '@/components/dashboard/gleap-provider'

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await auth()

  // Redirect to login if not authenticated
  if (!session?.user) {
    redirect('/login')
  }

  const store = await getCurrentStore()
  const messages = await getMessages()

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
            <div className="min-h-screen bg-background">
              {children}
            </div>
            <Toaster />
          </GleapProvider>
        </ThemeProvider>
      </PostHogProvider>
    </NextIntlClientProvider>
  )
}
