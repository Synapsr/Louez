'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { LogOut, Loader2 } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
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
        toast.error(tErrors('logoutError'))
        return
      }
      router.push(getUrl('/'))
      router.refresh()
    } catch {
      toast.error(tErrors('generic'))
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Button
      variant="outline"
      size="sm"
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
