'use client'

import Link from 'next/link'
import { User } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { Button } from '@/components/ui/button'

interface StoreHeaderProps {
  storeName: string
  storeSlug: string
  logoUrl?: string | null
}

export function StoreHeader({
  storeName,
  logoUrl,
}: StoreHeaderProps) {
  const t = useTranslations('storefront.header')

  return (
    <header className="fixed top-0 left-0 right-0 z-50 pointer-events-none">
      <div className="container mx-auto flex items-start justify-between px-4 py-4 md:py-6">
        {/* Logo - floating top left */}
        <Link
          href="/"
          className="pointer-events-auto"
        >
          {logoUrl ? (
            <img
              src={logoUrl}
              alt={storeName}
              className="h-10 md:h-14 max-w-[200px] object-contain drop-shadow-lg"
            />
          ) : (
            <span className="text-xl md:text-2xl font-bold bg-background/80 backdrop-blur-sm px-3 py-1.5 rounded-lg shadow-sm">
              {storeName}
            </span>
          )}
        </Link>

        {/* Account button - floating top right */}
        <Button
          size="sm"
          asChild
          className="pointer-events-auto gap-2 shadow-lg"
        >
          <Link href="/account">
            <User className="h-4 w-4" />
            <span className="hidden sm:inline">{t('myAccount')}</span>
          </Link>
        </Button>
      </div>
    </header>
  )
}
