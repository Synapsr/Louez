'use client'

import { useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'
import { Mail, MoreHorizontal, UserPlus, Users, Clock, Send, X, Crown, User as UserIcon, Zap, Lock, ArrowRight } from 'lucide-react'
import { toastManager } from '@louez/ui'
import Link from 'next/link'

import { Button } from '@louez/ui'
import { Input } from '@louez/ui'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@louez/ui'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@louez/ui'
import { Avatar, AvatarFallback, AvatarImage } from '@louez/ui'
import { Badge } from '@louez/ui'
import { Separator } from '@louez/ui'
import { addTeamMember, removeMember, cancelInvitation, resendInvitation } from './actions'

interface Member {
  id: string
  role: 'owner' | 'member'
  createdAt: Date
  user: {
    id: string
    email: string
    name: string | null
    image: string | null
  }
}

interface Invitation {
  id: string
  email: string
  status: string
  createdAt: Date
  expiresAt: Date
}

interface TeamLimits {
  allowed: boolean
  current: number
  limit: number | null
}

interface TeamContentProps {
  members: Member[]
  invitations: Invitation[]
  canManageMembers: boolean
  limits: TeamLimits | null
}

export function TeamContent({ members, invitations, canManageMembers, limits }: TeamContentProps) {
  const t = useTranslations('dashboard.team')
  const tErrors = useTranslations('errors')
  const [email, setEmail] = useState('')
  const [isPending, startTransition] = useTransition()

  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email.trim()) return

    startTransition(async () => {
      const formData = new FormData()
      formData.append('email', email.toLowerCase().trim())

      const result = await addTeamMember(formData)

      if (result.error) {
        const errorKey = result.error.startsWith('dashboard.') || result.error.startsWith('errors.')
          ? result.error
          : `errors.${result.error}`
        toastManager.add({ title: t(errorKey.replace('dashboard.team.', '')) || tErrors('generic'), type: 'error' })
      } else {
        if (result.type === 'invited') {
          toastManager.add({ title: t('invitationSent'), type: 'success' })
        } else {
          toastManager.add({ title: t('memberAdded'), type: 'success' })
        }
        setEmail('')
      }
    })
  }

  const handleRemoveMember = (memberId: string) => {
    startTransition(async () => {
      const result = await removeMember(memberId)

      if (result.error) {
        toastManager.add({ title: t(result.error.replace('dashboard.team.', '')) || tErrors('generic'), type: 'error' })
      } else {
        toastManager.add({ title: t('memberRemoved'), type: 'success' })
      }
    })
  }

  const handleCancelInvitation = (invitationId: string) => {
    startTransition(async () => {
      const result = await cancelInvitation(invitationId)

      if (result.error) {
        toastManager.add({ title: tErrors('generic'), type: 'error' })
      } else {
        toastManager.add({ title: t('invitationCancelled'), type: 'success' })
      }
    })
  }

  const handleResendInvitation = (invitationId: string) => {
    startTransition(async () => {
      const result = await resendInvitation(invitationId)

      if (result.error) {
        toastManager.add({ title: tErrors('generic'), type: 'error' })
      } else {
        toastManager.add({ title: t('invitationResent'), type: 'success' })
      }
    })
  }

  const getInitials = (name: string | null, email: string) => {
    if (name) {
      return name
        .split(' ')
        .map((n) => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2)
    }
    return email.slice(0, 2).toUpperCase()
  }

  // Determine limit state
  const hasNoCollaboratorAccess = limits && limits.limit === 0
  const isAtLimit = limits && !limits.allowed && limits.limit !== null && limits.limit > 0
  const canAddMore = limits?.allowed ?? true

  return (
    <div className="space-y-6">
      {/* Add Member Form */}
      {canManageMembers && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <UserPlus className="h-5 w-5" />
                  {t('addMember')}
                </CardTitle>
                <CardDescription>{t('addMemberDescription')}</CardDescription>
              </div>
              {/* Show usage badge only when there's a positive limit */}
              {limits && limits.limit !== null && limits.limit > 0 && (
                <Badge variant={canAddMore ? 'secondary' : 'outline'} className={!canAddMore ? 'border-amber-500/50 bg-amber-500/10 text-amber-600 dark:text-amber-400' : ''}>
                  {t('limitBadge', { current: limits.current, limit: limits.limit })}
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {/* Case 1: Feature not available (limit = 0) */}
            {hasNoCollaboratorAccess ? (
              <div className="rounded-lg border border-muted bg-muted/30 p-6">
                <div className="flex flex-col items-center text-center sm:flex-row sm:text-left sm:items-start gap-4">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary/10">
                    <Lock className="h-6 w-6 text-primary" />
                  </div>
                  <div className="flex-1 space-y-2">
                    <h3 className="font-semibold">{t('featureNotAvailable')}</h3>
                    <p className="text-sm text-muted-foreground">
                      {t('featureNotAvailableDescription')}
                    </p>
                  </div>
                  <Button render={<Link href="/dashboard/subscription" />} className="shrink-0 gap-2">
                    <Zap className="h-4 w-4" />
                    {t('upgradeToPro')}
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ) : isAtLimit ? (
              /* Case 2: At limit (limit > 0 but full) */
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-6">
                <div className="flex flex-col items-center text-center sm:flex-row sm:text-left sm:items-start gap-4">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-amber-500/10">
                    <Users className="h-6 w-6 text-amber-600 dark:text-amber-400" />
                  </div>
                  <div className="flex-1 space-y-2">
                    <h3 className="font-semibold text-amber-700 dark:text-amber-300">{t('limitReachedTitle')}</h3>
                    <p className="text-sm text-muted-foreground">
                      {t('limitReachedDescription', { current: limits?.current ?? 0, limit: limits?.limit ?? 0 })}
                    </p>
                  </div>
                  <Button render={<Link href="/dashboard/subscription" />} className="shrink-0 gap-2">
                    <Zap className="h-4 w-4" />
                    {t('upgradeForMore')}
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ) : (
              /* Case 3: Can add members */
              <>
                <form onSubmit={handleAddMember} className="flex gap-3">
                  <div className="flex-1">
                    <Input
                      type="email"
                      placeholder={t('emailPlaceholder')}
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      disabled={isPending}
                    />
                  </div>
                  <Button type="submit" disabled={isPending || !email.trim()}>
                    <Mail className="mr-2 h-4 w-4" />
                    {t('invite')}
                  </Button>
                </form>
                <p className="mt-3 text-sm text-muted-foreground">
                  {t('addMemberHint')}
                </p>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Pending Invitations */}
      {invitations.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5" />
              {t('pendingInvitations')}
              <Badge variant="secondary" className="ml-2">
                {invitations.length}
              </Badge>
            </CardTitle>
            <CardDescription>{t('pendingInvitationsDescription')}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {invitations.map((invitation) => (
                <div
                  key={invitation.id}
                  className="flex items-center justify-between rounded-lg border bg-muted/30 p-4"
                >
                  <div className="flex items-center gap-4">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-dashed border-muted-foreground/30">
                      <Mail className="h-4 w-4 text-muted-foreground" />
                    </div>
                    <div>
                      <p className="font-medium">{invitation.email}</p>
                      <p className="text-sm text-muted-foreground">
                        {t('invitedOn', {
                          date: format(new Date(invitation.createdAt), 'dd MMM yyyy', { locale: fr }),
                        })}
                      </p>
                    </div>
                  </div>
                  {canManageMembers && (
                    <div className="flex items-center gap-2">
                      <Button
                        variant="ghost"
                        onClick={() => handleResendInvitation(invitation.id)}
                        disabled={isPending}
                      >
                        <Send className="mr-2 h-4 w-4" />
                        {t('resend')}
                      </Button>
                      <Button
                        variant="ghost"
                        onClick={() => handleCancelInvitation(invitation.id)}
                        disabled={isPending}
                      >
                        <X className="mr-2 h-4 w-4" />
                        {t('cancel')}
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Members List */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            {t('members')}
            <Badge variant="secondary" className="ml-2">
              {members.length}
            </Badge>
          </CardTitle>
          <CardDescription>{t('membersDescription')}</CardDescription>
        </CardHeader>
        <CardContent>
          {members.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Users className="mb-4 h-12 w-12 text-muted-foreground/50" />
              <p className="text-muted-foreground">{t('noMembers')}</p>
            </div>
          ) : (
            <div className="space-y-1">
              {members.map((member, index) => (
                <div key={member.id}>
                  {index > 0 && <Separator className="my-3" />}
                  <div className="flex items-center justify-between py-2">
                    <div className="flex items-center gap-4">
                      <Avatar className="h-10 w-10">
                        <AvatarImage src={member.user.image || undefined} />
                        <AvatarFallback className="bg-primary/10 text-primary">
                          {getInitials(member.user.name, member.user.email)}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="font-medium">
                            {member.user.name || member.user.email}
                          </p>
                          <Badge
                            variant={member.role === 'owner' ? 'default' : 'secondary'}
                            className="flex items-center gap-1"
                          >
                            {member.role === 'owner' ? (
                              <Crown className="h-3 w-3" />
                            ) : (
                              <UserIcon className="h-3 w-3" />
                            )}
                            {t(member.role === 'owner' ? 'ownerBadge' : 'memberBadge')}
                          </Badge>
                        </div>
                        {member.user.name && (
                          <p className="text-sm text-muted-foreground">
                            {member.user.email}
                          </p>
                        )}
                        <p className="text-xs text-muted-foreground">
                          {t('addedOn', {
                            date: format(new Date(member.createdAt), 'dd MMM yyyy', { locale: fr }),
                          })}
                        </p>
                      </div>
                    </div>
                    {canManageMembers && member.role !== 'owner' && (
                      <DropdownMenu>
                        <DropdownMenuTrigger render={<Button variant="ghost" size="icon" />}>
                          <MoreHorizontal className="h-4 w-4" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem
                            className="text-destructive"
                            onClick={() => handleRemoveMember(member.id)}
                          >
                            {t('removeMember')}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
