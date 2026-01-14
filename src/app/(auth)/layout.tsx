import { NextIntlClientProvider } from 'next-intl'
import { getMessages } from 'next-intl/server'
import { redirect } from 'next/navigation'
import { auth } from '@/lib/auth'

export default async function AuthLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await auth()

  // Redirect to dashboard if already authenticated
  if (session?.user) {
    redirect('/dashboard')
  }

  const messages = await getMessages()

  return (
    <NextIntlClientProvider messages={messages}>
      <div className="min-h-screen bg-background">
        {children}
      </div>
    </NextIntlClientProvider>
  )
}
