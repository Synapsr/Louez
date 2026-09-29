import { getTranslations } from 'next-intl/server'
import { auth } from '@/lib/auth'
import { db } from '@louez/db'
import { users } from '@louez/db'
import { eq } from 'drizzle-orm'
import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { format } from 'date-fns'

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@louez/ui'
import { Alert, AlertDescription } from '@louez/ui'
import { Button } from '@louez/ui'
import { Badge } from '@louez/ui'
import { Separator } from '@louez/ui'
import { CalendarIcon, MailIcon } from '@louez/ui/icons'
import { canRemovePassword } from '@louez/auth/password'

import { getAccountDeletionPreview } from '@/lib/account-deletion/account-deletion'
import { accountDeletionRepository } from '@/lib/account-deletion/database-repository'
import { getInstanceConfig, isStandaloneMode } from '@/lib/deployment'
import { parseKeyboardShortcutOverrides } from '@/lib/keyboard-shortcuts'

import { AccountDeletionDialog } from './account-deletion-dialog'
import { AccountInfoForm } from './account-info-form'
import { KeyboardShortcutsSettings } from './keyboard-shortcuts-settings'
import { getSignInOverview } from './queries'
import { SignInMethodsCard } from './sign-in-methods-card'
import { getRequestFormatLocale } from '@/lib/i18n/format-locale.server'

// TODO: Cache Components adoption. Refactor this route so this opt-out can be removed.
// See: https://nextjs.org/docs/app/guides/migrating-to-cache-components
export const instant = false;

export default async function AccountSettingsPage({
  searchParams,
}: {
  // Set by better-auth when Google refuses to link (other e-mail, account
  // already linked elsewhere) and sends the browser back here.
  searchParams: Promise<{ error?: string | string[] }>
}) {
  const session = await auth()
  if (!session?.user?.id) {
    redirect('/login')
  }

  const user = await db.query.users.findFirst({
    where: eq(users.id, session.user.id),
  })

  if (!user) {
    redirect('/login')
  }

  const t = await getTranslations('dashboard.settings')
  const { dateFns: dateLocale } = await getRequestFormatLocale()
  const [accountDeletionPreview, signInOverview, { error: linkError }] = await Promise.all([
    getAccountDeletionPreview({
      userId: user.id,
      repository: accountDeletionRepository,
    }),
    getSignInOverview(user.id, await headers()),
    searchParams,
  ])
  const instance = getInstanceConfig()

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t('accountSettings.title')}</h1>
        <p className="text-muted-foreground">
          {t('accountSettings.description')}
        </p>
      </div>

      {/* User Info */}
      <Card>
        <CardHeader>
          <CardTitle>{t('accountSettings.accountInfo')}</CardTitle>
          <CardDescription>
            {t('accountSettings.personalInfo')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <AccountInfoForm
            initialName={user.name || ''}
            initialImage={user.image}
            avatarSeed={user.id}
          />

          <Separator />

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <MailIcon className="h-4 w-4" />
                {t('accountSettings.email')}
              </div>
              <p className="font-medium">{user.email}</p>
              {user.emailVerified && (
                <Badge variant="success">
                  {t('accountSettings.emailVerified')}
                </Badge>
              )}
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <CalendarIcon className="h-4 w-4" />
                {t('accountSettings.memberSince')}
              </div>
              <p className="font-medium">
                {format(user.createdAt, 'dd MMMM yyyy', { locale: dateLocale })}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <KeyboardShortcutsSettings
        initialShortcuts={parseKeyboardShortcutOverrides(user.keyboardShortcuts)}
      />

      {linkError && (
        <Alert variant="error">
          <AlertDescription>{t('accountSettings.signIn.googleLinkError')}</AlertDescription>
        </Alert>
      )}

      <SignInMethodsCard
        email={user.email}
        emailCodeAvailable={instance.emailConfigured}
        google={
          instance.googleAuthConfigured
            ? { linked: signInOverview.googleLinked }
            : null
        }
        passwordSetAt={signInOverview.passwordSetAt}
        canRemovePassword={canRemovePassword()}
        activeSessionCount={signInOverview.activeSessionCount}
      />

      {/* Danger Zone */}
      <Card className="border-destructive/50">
        <CardHeader>
          <CardTitle className="text-destructive">{t('accountSettings.dangerZone')}</CardTitle>
          <CardDescription>
            {t('accountSettings.dangerZoneDescription')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between rounded-lg border border-destructive/20 p-4">
            <div>
              <p className="font-medium">{t('accountSettings.deleteAccount')}</p>
              <p className="text-sm text-muted-foreground">
                {t('accountSettings.deleteAccountDescription')}
              </p>
            </div>
            <AccountDeletionDialog
              preview={accountDeletionPreview}
              verification={isStandaloneMode() ? 'password' : 'email'}
            />
          </div>
        </CardContent>
      </Card>

      {/* Sign Out */}
      <Card>
        <CardContent className="pt-6">
          <form action="/api/auth/signout" method="POST">
            <Button variant="outline" type="submit" className="w-full sm:w-auto">
              {t('accountSettings.signOut')}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}
