import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'

import { getCurrentStore, currentUserHasPermission } from '@/lib/store-context'
import { SettingsNav } from '@/components/dashboard/settings-nav'
import { TeamContent } from './team-content'
import { getTeamData } from './actions'

export default async function TeamPage() {
  const store = await getCurrentStore()

  if (!store) {
    redirect('/onboarding')
  }

  const t = await getTranslations('dashboard.team')
  const canManageMembers = await currentUserHasPermission('manage_members')
  const { members, invitations, limits } = await getTeamData()

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
        <p className="text-muted-foreground">{t('description')}</p>
      </div>

      <SettingsNav />

      <TeamContent
        members={members}
        invitations={invitations}
        canManageMembers={canManageMembers}
        limits={limits}
      />
    </div>
  )
}
