import type { Metadata } from 'next';
import { Inter } from 'next/font/google';

import { Agentation } from 'agentation';

import { AnchoredToastProvider, ToastProvider } from '@louez/ui';

import { UmamiAnalytics } from '@/components/umami-analytics';

import { ORPCProvider } from '@/lib/orpc/provider';

// Import translations directly since this is a root layout without NextIntlProvider
import messages from '@/messages/fr.json';

import './globals.css';

const inter = Inter({
  variable: '--font-inter',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: {
    default: messages.app.name,
    template: `%s | ${messages.app.name}`,
  },
  description: messages.app.description,
  icons: {
    icon: [
      { url: '/favicon.svg', type: 'image/svg+xml' },
      { url: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
      { url: '/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
    ],
    apple: '/apple-touch-icon.png',
    shortcut: '/favicon.svg',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <>
      {process.env.NODE_ENV === 'development' && <Agentation />}

      <html lang="fr" suppressHydrationWarning>
        <UmamiAnalytics />

        <head>
          <link
            href="https://api.fontshare.com/v2/css?f[]=cabinet-grotesk@800&display=swap"
            rel="stylesheet"
          />
        </head>
        <body className={`${inter.variable} font-sans antialiased`}>
          <ORPCProvider>
            <ToastProvider position="bottom-right">
              <AnchoredToastProvider>{children}</AnchoredToastProvider>
            </ToastProvider>
          </ORPCProvider>
        </body>
      </html>
    </>
  );
}
