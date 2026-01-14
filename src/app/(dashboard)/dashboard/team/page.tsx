'use client'

import { useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import { Users, Loader2, Trash2, Crown, UserIcon } from 'lucide-react'
import { useEffect } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { addMember, removeMember, getTeamMembers } from './actions'

type TeamMember = {
  id: string
  role: 'owner' | 'member'
  createdAt: Date
  userId: string
  userName: string | null
  userEmail: string
  userImage: string | null
}

export default function TeamSettingsPage() {
  const t = useTranslations('dashboard.team')
  const tCommon = useTranslations('common')
  const [members, setMembers] = useState<TeamMember[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isPending, startTransition] = useTransition()
  const [email, setEmail] = useState('')

  useEffect(() => {
    loadMembers()
  }, [])

  async function loadMembers() {
    setIsLoading(true)
    try {
      const data = await getTeamMembers()
      setMembers(data as TeamMember[])
    } catch {
      toast.error(tCommon('error'))
    } finally {
      setIsLoading(false)
    }
  }

  async function handleAddMember(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim()) return

    startTransition(async () => {
      const formData = new FormData()
      formData.set('email', email)
      const result = await addMember(formData)

      if (result.error) {
        toast.error(t(result.error.replace('dashboard.team.', '')) || result.error)
      } else {
        toast.success(t('memberAdded'))
        setEmail('')
        loadMembers()
      }
    })
  }

  async function handleRemoveMember(memberId: string) {
    startTransition(async () => {
      const result = await removeMember(memberId)

      if (result.error) {
        toast.error(t(result.error.replace('dashboard.team.', '')) || result.error)
      } else {
        toast.success(t('memberRemoved'))
        loadMembers()
      }
    })
  }

  // Separate owner and members
  const owner = members.find((m) => m.role === 'owner')
  const collaborators = members.filter((m) => m.role === 'member')

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t('title')}</h1>
        <p className="text-muted-foreground">{t('description')}</p>
      </div>

      {/* Add Member Form */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            {t('addMember')}
          </CardTitle>
          <CardDescription>
            {t('userNotFound').split('.')[0]}.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleAddMember} className="flex gap-3">
            <Input
              type="email"
              placeholder={t('emailPlaceholder')}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="max-w-sm"
            />
            <Button type="submit" disabled={isPending || !email.trim()}>
              {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {tCommon('add')}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Members List */}
      <Card>
        <CardHeader>
          <CardTitle>{t('members')}</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : members.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">
              {t('noMembers')}
            </p>
          ) : (
            <div className="space-y-4">
              {/* Owner */}
              {owner && (
                <div className="flex items-center justify-between p-4 rounded-lg border bg-primary/5">
                  <div className="flex items-center gap-4">
                    <Avatar className="h-10 w-10">
                      <AvatarImage src={owner.userImage || undefined} />
                      <AvatarFallback>
                        {owner.userName?.charAt(0) || owner.userEmail.charAt(0).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">
                          {owner.userName || owner.userEmail}
                        </span>
                        <Badge variant="default" className="gap-1">
                          <Crown className="h-3 w-3" />
                          {t('ownerBadge')}
                        </Badge>
                      </div>
                      <span className="text-sm text-muted-foreground">
                        {owner.userEmail}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              {/* Collaborators */}
              {collaborators.map((member) => (
                <div
                  key={member.id}
                  className="flex items-center justify-between p-4 rounded-lg border"
                >
                  <div className="flex items-center gap-4">
                    <Avatar className="h-10 w-10">
                      <AvatarImage src={member.userImage || undefined} />
                      <AvatarFallback>
                        {member.userName?.charAt(0) || member.userEmail.charAt(0).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">
                          {member.userName || member.userEmail}
                        </span>
                        <Badge variant="secondary" className="gap-1">
                          <UserIcon className="h-3 w-3" />
                          {t('memberBadge')}
                        </Badge>
                      </div>
                      <span className="text-sm text-muted-foreground">
                        {member.userEmail}
                      </span>
                    </div>
                  </div>

                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-destructive hover:text-destructive hover:bg-destructive/10"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>
                          {t('removeMember')} ?
                        </AlertDialogTitle>
                        <AlertDialogDescription>
                          {member.userName || member.userEmail}
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>{tCommon('cancel')}</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => handleRemoveMember(member.id)}
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                          {t('removeMember')}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
