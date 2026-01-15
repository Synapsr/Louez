'use client'

import Link from 'next/link'
import { Mail, Phone } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { LanguageSwitcher } from '@/components/ui/language-switcher'

interface StoreFooterProps {
  storeName: string
  storeSlug: string
  email?: string | null
  phone?: string | null
  address?: string | null
}

export function StoreFooter({
  storeName,
  storeSlug,
  email,
  phone,
}: StoreFooterProps) {
  const t = useTranslations('storefront.footer')
  const currentYear = new Date().getFullYear()

  const hasContact = email || phone

  return (
    <footer className="bg-muted/30">
      <div className="container mx-auto px-4 py-8">
        <div className="flex flex-col gap-6">
          {/* Main row */}
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            {/* Store info */}
            <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-6">
              <span className="font-semibold text-lg">{storeName}</span>
              {hasContact && (
                <div className="flex items-center gap-4 text-sm text-muted-foreground">
                  {email && (
                    <a
                      href={`mailto:${email}`}
                      className="flex items-center gap-1.5 hover:text-foreground transition-colors"
                    >
                      <Mail className="h-4 w-4" />
                      <span className="hidden sm:inline">{email}</span>
                    </a>
                  )}
                  {phone && (
                    <a
                      href={`tel:${phone}`}
                      className="flex items-center gap-1.5 hover:text-foreground transition-colors"
                    >
                      <Phone className="h-4 w-4" />
                      <span>{phone}</span>
                    </a>
                  )}
                </div>
              )}
            </div>

            {/* Legal links */}
            <div className="flex items-center gap-6 text-sm">
              <Link
                href={`/${storeSlug}/terms`}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                {t('cgv')}
              </Link>
              <Link
                href={`/${storeSlug}/legal`}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                {t('legalNotice')}
              </Link>
            </div>
          </div>

          {/* Copyright row */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-xs text-muted-foreground">
            <p>&copy; {currentYear} {storeName}</p>
            <div className="flex items-center gap-4">
              <LanguageSwitcher variant="compact" />
              <p>
                {t('poweredBy')}{' '}
                <a
                  href="https://louez.io"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-medium text-foreground/70 hover:text-foreground transition-colors"
                >
                  Louez.io
                </a>
              </p>
            </div>
          </div>
        </div>
      </div>
    </footer>
  )
}
