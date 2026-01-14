import { getTranslations } from 'next-intl/server'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { users } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { redirect } from 'next/navigation'
import { Mail, Calendar, Shield } from 'lucide-react'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'

export default async function AccountSettingsPage() {
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
  const tCommon = await getTranslations('common')

  const initials = user.email.slice(0, 2).toUpperCase()

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
          <div className="flex items-center gap-4">
            <Avatar className="h-16 w-16">
              <AvatarImage src={user.image || undefined} />
              <AvatarFallback className="text-lg">{initials}</AvatarFallback>
            </Avatar>
            <div>
              <p className="font-medium">{user.name || t('accountSettings.user')}</p>
              <p className="text-sm text-muted-foreground">{user.email}</p>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Mail className="h-4 w-4" />
                {t('accountSettings.email')}
              </div>
              <p className="font-medium">{user.email}</p>
              {user.emailVerified && (
                <Badge variant="secondary" className="text-green-600">
                  {t('accountSettings.emailVerified')}
                </Badge>
              )}
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Calendar className="h-4 w-4" />
                {t('accountSettings.memberSince')}
              </div>
              <p className="font-medium">
                {format(user.createdAt, 'dd MMMM yyyy', { locale: fr })}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Security */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            {t('accountSettings.security')}
          </CardTitle>
          <CardDescription>
            {t('accountSettings.securityDescription')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between rounded-lg border p-4">
            <div>
              <p className="font-medium">{t('accountSettings.authentication')}</p>
              <p className="text-sm text-muted-foreground">
                {t('accountSettings.connectedVia', { method: session.user.email?.includes('@') ? 'email' : 'OAuth' })}
              </p>
            </div>
            <Badge variant="outline">{t('accountSettings.active')}</Badge>
          </div>

          <div className="flex items-center justify-between rounded-lg border p-4">
            <div>
              <p className="font-medium">{t('accountSettings.activeSessions')}</p>
              <p className="text-sm text-muted-foreground">
                {t('accountSettings.activeSessionsDescription')}
              </p>
            </div>
            <Badge variant="secondary">{t('accountSettings.sessionCount', { count: 1 })}</Badge>
          </div>
        </CardContent>
      </Card>

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
            <Button variant="destructive" size="sm" disabled>
              {tCommon('delete')}
            </Button>
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
