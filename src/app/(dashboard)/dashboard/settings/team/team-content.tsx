'use client'

import { useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'
import { Mail, MoreHorizontal, UserPlus, Users, Clock, Send, X, Crown, User as UserIcon } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
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

interface TeamContentProps {
  members: Member[]
  invitations: Invitation[]
  canManageMembers: boolean
}

export function TeamContent({ members, invitations, canManageMembers }: TeamContentProps) {
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
        toast.error(t(errorKey.replace('dashboard.team.', '')) || tErrors('generic'))
      } else {
        if (result.type === 'invited') {
          toast.success(t('invitationSent'))
        } else {
          toast.success(t('memberAdded'))
        }
        setEmail('')
      }
    })
  }

  const handleRemoveMember = (memberId: string) => {
    startTransition(async () => {
      const result = await removeMember(memberId)

      if (result.error) {
        toast.error(t(result.error.replace('dashboard.team.', '')) || tErrors('generic'))
      } else {
        toast.success(t('memberRemoved'))
      }
    })
  }

  const handleCancelInvitation = (invitationId: string) => {
    startTransition(async () => {
      const result = await cancelInvitation(invitationId)

      if (result.error) {
        toast.error(tErrors('generic'))
      } else {
        toast.success(t('invitationCancelled'))
      }
    })
  }

  const handleResendInvitation = (invitationId: string) => {
    startTransition(async () => {
      const result = await resendInvitation(invitationId)

      if (result.error) {
        toast.error(tErrors('generic'))
      } else {
        toast.success(t('invitationResent'))
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

  return (
    <div className="space-y-6">
      {/* Add Member Form */}
      {canManageMembers && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <UserPlus className="h-5 w-5" />
              {t('addMember')}
            </CardTitle>
            <CardDescription>{t('addMemberDescription')}</CardDescription>
          </CardHeader>
          <CardContent>
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
                        size="sm"
                        onClick={() => handleResendInvitation(invitation.id)}
                        disabled={isPending}
                      >
                        <Send className="mr-2 h-4 w-4" />
                        {t('resend')}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
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
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon">
                            <MoreHorizontal className="h-4 w-4" />
                          </Button>
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
