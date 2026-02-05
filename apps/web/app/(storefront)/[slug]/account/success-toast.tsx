'use client'

import { useEffect, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'

export function SuccessToast() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const t = useTranslations('storefront.account')
  const hasShown = useRef(false)

  useEffect(() => {
    const successType = searchParams.get('success')

    if (successType && !hasShown.current) {
      hasShown.current = true

      if (successType === 'payment') {
        toast.success(t('successToast.payment'), {
          description: t('successToast.paymentDescription'),
          duration: 5000,
        })
      } else if (successType === 'deposit') {
        toast.success(t('successToast.deposit'), {
          description: t('successToast.depositDescription'),
          duration: 5000,
        })
      }

      // Clean URL after showing toast
      const url = new URL(window.location.href)
      url.searchParams.delete('success')
      url.searchParams.delete('reservation')
      router.replace(url.pathname, { scroll: false })
    }
  }, [searchParams, router, t])

  return null
}
