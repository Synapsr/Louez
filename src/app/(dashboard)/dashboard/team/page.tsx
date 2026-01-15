import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'

import { getCurrentStore, currentUserHasPermission } from '@/lib/store-context'
import { TeamContent } from '../settings/team/team-content'
import { getTeamData } from '../settings/team/actions'

export default async function TeamPage() {
  const store = await getCurrentStore()

  if (!store) {
    redirect('/onboarding')
  }

  const t = await getTranslations('dashboard.team')
  const canManageMembers = await currentUserHasPermission('manage_members')
  const { members, invitations, limits } = await getTeamData()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
        <p className="text-muted-foreground">{t('description')}</p>
      </div>

      <TeamContent
        members={members}
        invitations={invitations}
        canManageMembers={canManageMembers}
        limits={limits}
      />
    </div>
  )
}
