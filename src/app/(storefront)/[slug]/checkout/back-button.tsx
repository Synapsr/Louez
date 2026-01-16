'use client'

import { useRouter } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { Button } from '@/components/ui/button'

export function BackButton() {
  const router = useRouter()
  const t = useTranslations('storefront.checkout')

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => router.back()}
      className="mb-6"
    >
      <ArrowLeft className="mr-2 h-4 w-4" />
      {t('back')}
    </Button>
  )
}
