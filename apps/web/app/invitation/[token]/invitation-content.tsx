'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { CheckCircle, XCircle, Clock, Mail, AlertTriangle, LogIn, UserPlus } from 'lucide-react'
import { toast } from 'sonner'
import { useTranslations } from 'next-intl'

import { Button } from '@louez/ui'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@louez/ui'
import { Avatar, AvatarFallback, AvatarImage } from '@louez/ui'
import { authClient } from '@louez/auth/client'
import { acceptInvitation } from './actions'

type InvitationType = 'ready' | 'login_required' | 'email_mismatch' | 'expired' | 'used'

interface InvitationContentProps {
  type: InvitationType
  storeName: string
  storeLogoUrl?: string | null
  inviterName?: string
  invitedEmail?: string
  currentEmail?: string
  token?: string
}

export function InvitationContent({
  type,
  storeName,
  storeLogoUrl,
  inviterName,
  invitedEmail,
  currentEmail,
  token,
}: InvitationContentProps) {
  const router = useRouter()
  const t = useTranslations('invitation')
  const [isPending, startTransition] = useTransition()

  const handleAccept = () => {
    if (!token) return

    startTransition(async () => {
      const result = await acceptInvitation(token)

      if (result.error) {
        toast.error(result.error)
      } else {
        toast.success(t('joinedTeam'))
        router.push('/dashboard')
      }
    })
  }

  const getInitial = (name: string) => name.charAt(0).toUpperCase()

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-background to-muted/30 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-4">
            <Avatar className="h-16 w-16">
              <AvatarImage src={storeLogoUrl || undefined} />
              <AvatarFallback className="bg-primary/10 text-primary text-xl font-bold">
                {getInitial(storeName)}
              </AvatarFallback>
            </Avatar>
          </div>
          <CardTitle className="text-xl">{storeName}</CardTitle>
          {type === 'ready' && (
            <CardDescription>
              {t('inviteToJoin', { name: inviterName || '' })}
            </CardDescription>
          )}
          {type === 'login_required' && (
            <CardDescription>
              {t('inviteToJoin', { name: inviterName || '' })}
            </CardDescription>
          )}
        </CardHeader>

        <CardContent className="space-y-4">
          {type === 'ready' && (
            <div className="text-center space-y-4">
              <div className="p-4 rounded-lg bg-green-50 dark:bg-green-950/30">
                <CheckCircle className="h-12 w-12 text-green-600 mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">
                  {t('readyToJoin', { storeName })}
                </p>
              </div>
              <p className="text-sm text-muted-foreground">
                {t('accessDescription')}
              </p>
            </div>
          )}

          {type === 'login_required' && (
            <div className="text-center space-y-4">
              <div className="p-4 rounded-lg bg-blue-50 dark:bg-blue-950/30">
                <Mail className="h-12 w-12 text-blue-600 mx-auto mb-2" />
                <p className="font-medium">{invitedEmail}</p>
                <p className="text-sm text-muted-foreground mt-2">
                  {t('loginRequired')}
                </p>
              </div>
            </div>
          )}

          {type === 'email_mismatch' && (
            <div className="text-center space-y-4">
              <div className="p-4 rounded-lg bg-amber-50 dark:bg-amber-950/30">
                <AlertTriangle className="h-12 w-12 text-amber-600 mx-auto mb-2" />
                <p className="text-sm font-medium">{t('emailMismatchTitle')}</p>
                <p className="text-sm text-muted-foreground mt-2">
                  {t('emailMismatchDescription', { invitedEmail: invitedEmail || '', currentEmail: currentEmail || '' })}
                </p>
              </div>
              <p className="text-sm text-muted-foreground">
                {t('emailMismatchHint')}
              </p>
            </div>
          )}

          {type === 'expired' && (
            <div className="text-center space-y-4">
              <div className="p-4 rounded-lg bg-orange-50 dark:bg-orange-950/30">
                <Clock className="h-12 w-12 text-orange-600 mx-auto mb-2" />
                <p className="font-medium">{t('expiredTitle')}</p>
                <p className="text-sm text-muted-foreground mt-2">
                  {t('expiredDescription')}
                </p>
              </div>
            </div>
          )}

          {type === 'used' && (
            <div className="text-center space-y-4">
              <div className="p-4 rounded-lg bg-gray-50 dark:bg-gray-950/30">
                <XCircle className="h-12 w-12 text-gray-400 mx-auto mb-2" />
                <p className="font-medium">{t('usedTitle')}</p>
                <p className="text-sm text-muted-foreground mt-2">
                  {t('usedDescription')}
                </p>
              </div>
            </div>
          )}
        </CardContent>

        <CardFooter className="flex flex-col gap-3">
          {type === 'ready' && (
            <Button
              onClick={handleAccept}
              disabled={isPending}
              className="w-full"
              size="lg"
            >
              <UserPlus className="mr-2 h-4 w-4" />
              {isPending ? t('accepting') : t('acceptInvitation')}
            </Button>
          )}

          {type === 'login_required' && (
            <>
              <Button asChild className="w-full" size="lg">
                <Link href={`/login?callbackUrl=/invitation/${token}`}>
                  <LogIn className="mr-2 h-4 w-4" />
                  {t('login')}
                </Link>
              </Button>
              <p className="text-xs text-center text-muted-foreground">
                {t('loginHint')}
              </p>
            </>
          )}

          {type === 'email_mismatch' && (
            <Button
              variant="outline"
              className="w-full"
              onClick={() => authClient.signOut({ fetchOptions: { onSuccess: () => { window.location.href = '/login' } } })}
            >
              {t('logout')}
            </Button>
          )}

          {(type === 'expired' || type === 'used') && (
            <Button asChild variant="outline" className="w-full">
              <Link href="/">
                {t('backToHome')}
              </Link>
            </Button>
          )}
        </CardFooter>
      </Card>
    </div>
  )
}
