import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
// Import translations directly since this is a root layout without NextIntlProvider
import messages from '@/messages/fr.json'

const inter = Inter({
  variable: '--font-inter',
  subsets: ['latin'],
})

export const metadata: Metadata = {
  title: {
    default: messages.app.name,
    template: `%s | ${messages.app.name}`,
  },
  description: messages.app.description,
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="fr" suppressHydrationWarning>
      <body className={`${inter.variable} font-sans antialiased`}>
        {children}
      </body>
    </html>
  )
}
