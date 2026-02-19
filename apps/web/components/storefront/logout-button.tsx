'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { LogOut, Loader2 } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { toastManager } from '@louez/ui'

import { Button } from '@louez/ui'
import { useStorefrontUrl } from '@/hooks/use-storefront-url'
import { logout } from '@/app/(storefront)/[slug]/account/actions'

interface LogoutButtonProps {
  storeSlug: string
}

export function LogoutButton({ storeSlug }: LogoutButtonProps) {
  const router = useRouter()
  const t = useTranslations('storefront.account')
  const tErrors = useTranslations('errors')
  const { getUrl } = useStorefrontUrl(storeSlug)
  const [isLoading, setIsLoading] = useState(false)

  async function handleLogout() {
    setIsLoading(true)
    try {
      const result = await logout()
      if (result.error) {
        toastManager.add({ title: tErrors('logoutError'), type: 'error' })
        return
      }
      router.push(getUrl('/'))
      router.refresh()
    } catch {
      toastManager.add({ title: tErrors('generic'), type: 'error' })
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Button
      variant="outline"
      onClick={handleLogout}
      disabled={isLoading}
      className="gap-2 bg-background/80 backdrop-blur-sm"
    >
      {isLoading ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <LogOut className="h-4 w-4" />
      )}
      {t('logout')}
    </Button>
  )
}
