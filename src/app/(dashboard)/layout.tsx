import { NextIntlClientProvider } from 'next-intl'
import { getMessages } from 'next-intl/server'
import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'
import { Toaster } from '@/components/ui/sonner'
import { ThemeProvider } from '@/components/theme-provider'
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

  const messages = await getMessages()

  return (
    <NextIntlClientProvider messages={messages}>
      <ThemeProvider
        attribute="class"
        defaultTheme="system"
        enableSystem
        disableTransitionOnChange
      >
        <GleapProvider>
          <div className="min-h-screen bg-background">
            {children}
          </div>
          <Toaster />
        </GleapProvider>
      </ThemeProvider>
    </NextIntlClientProvider>
  )
}
