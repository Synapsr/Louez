'use client';

import Link from 'next/link';

import { Mail, MapPin, Phone } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { LanguageSwitcher } from '@/components/ui/language-switcher';

interface StoreFooterProps {
  storeName: string;
  storeSlug: string;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
}

export function StoreFooter({
  storeName,
  email,
  phone,
  address,
}: StoreFooterProps) {
  const t = useTranslations('storefront.footer');
  const tHeader = useTranslations('storefront.header');
  const tReviews = useTranslations('storefront.reviews');
  const currentYear = new Date().getFullYear();

  return (
    <footer className="bg-zinc-950 px-6 py-12 text-zinc-400 md:px-16">
      <div className="mx-auto w-full max-w-6xl">
        <div className="flex flex-col gap-10 md:flex-row md:justify-between">
          <div className="max-w-xs space-y-5">
            <p className="text-base font-bold text-white">{storeName}</p>

            <div className="space-y-2.5 text-sm">
              {email && (
                <a
                  href={`mailto:${email}`}
                  className="flex items-center gap-2.5 transition-colors hover:text-white"
                >
                  <Mail className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
                  {email}
                </a>
              )}
              {phone && (
                <a
                  href={`tel:${phone}`}
                  className="flex items-center gap-2.5 transition-colors hover:text-white"
                >
                  <Phone className="h-3.5 w-3.5 shrink-0 text-zinc-500" />
                  {phone}
                </a>
              )}
              {address && (
                <a
                  href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-start gap-2.5 transition-colors hover:text-white"
                >
                  <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zinc-500" />
                  <span className="whitespace-pre-line">{address}</span>
                </a>
              )}
            </div>
          </div>

          <div className="flex flex-wrap gap-12 text-sm md:gap-16">
            <div className="space-y-3">
              <p className="text-xs font-semibold tracking-wider text-zinc-500 uppercase">
                Navigation
              </p>
              <nav className="flex flex-col gap-2">
                <Link
                  href="/catalog"
                  className="transition-colors hover:text-white"
                >
                  {tHeader('catalog')}
                </Link>
                <Link
                  href="/#reviews"
                  className="transition-colors hover:text-white"
                >
                  {tReviews('title')}
                </Link>
                <Link
                  href="/#contact"
                  className="transition-colors hover:text-white"
                >
                  {t('contact')}
                </Link>
              </nav>
            </div>

            <div className="space-y-3">
              <p className="text-xs font-semibold tracking-wider text-zinc-500 uppercase">
                {t('legalInfo')}
              </p>
              <nav className="flex flex-col gap-2">
                <Link
                  href="/terms"
                  className="transition-colors hover:text-white"
                >
                  {t('cgv')}
                </Link>
                <Link
                  href="/legal"
                  className="transition-colors hover:text-white"
                >
                  {t('legalNotice')}
                </Link>
              </nav>
            </div>

            <div className="space-y-3">
              <p className="text-xs font-semibold tracking-wider text-zinc-500 uppercase">
                {tHeader('account')}
              </p>
              <nav className="flex flex-col gap-2">
                <Link
                  href="/account/login"
                  className="transition-colors hover:text-white"
                >
                  {t('signIn')}
                </Link>
                <Link
                  href="/account"
                  className="transition-colors hover:text-white"
                >
                  {tHeader('myReservations')}
                </Link>
              </nav>
            </div>
          </div>
        </div>

        <div className="mt-10 flex flex-col items-center justify-between gap-3 border-t border-zinc-800 pt-6 text-xs md:flex-row">
          <p>
            &copy; {currentYear} {storeName}. {t('allRightsReserved')}
          </p>
          <div className="flex items-center gap-4">
            <LanguageSwitcher
              variant="compact"
              className="text-zinc-400 hover:bg-zinc-900 hover:text-white"
            />
            <span className="text-zinc-700">·</span>
            <p>
              {t('poweredBy')}{' '}
              <a
                href="https://louez.io"
                target="_blank"
                rel="noopener noreferrer"
                className="text-white hover:underline"
              >
                Louez.io
              </a>
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
}
