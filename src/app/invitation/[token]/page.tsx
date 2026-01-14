import { redirect, notFound } from 'next/navigation'
import { db } from '@/lib/db'
import { storeInvitations, storeMembers, stores, users } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { auth, signIn } from '@/lib/auth'
import { InvitationContent } from './invitation-content'

interface InvitationPageProps {
  params: Promise<{
    token: string
  }>
}

export default async function InvitationPage({ params }: InvitationPageProps) {
  const { token } = await params

  // Find the invitation
  const invitation = await db.query.storeInvitations.findFirst({
    where: eq(storeInvitations.token, token),
    with: {
      store: true,
      invitedByUser: true,
    },
  })

  if (!invitation) {
    notFound()
  }

  // Check if invitation is expired
  const isExpired = new Date() > new Date(invitation.expiresAt)

  // Check if invitation was already used or cancelled
  if (invitation.status !== 'pending') {
    return (
      <InvitationContent
        type="used"
        storeName={invitation.store.name}
        storeLogoUrl={invitation.store.logoUrl}
      />
    )
  }

  if (isExpired) {
    return (
      <InvitationContent
        type="expired"
        storeName={invitation.store.name}
        storeLogoUrl={invitation.store.logoUrl}
      />
    )
  }

  // Check if user is logged in
  const session = await auth()

  if (!session?.user?.id) {
    // Not logged in - show login/signup prompt
    return (
      <InvitationContent
        type="login_required"
        storeName={invitation.store.name}
        storeLogoUrl={invitation.store.logoUrl}
        inviterName={invitation.invitedByUser?.name || invitation.invitedByUser?.email || 'Un membre'}
        invitedEmail={invitation.email}
        token={token}
      />
    )
  }

  // User is logged in - check if email matches
  const user = await db.query.users.findFirst({
    where: eq(users.id, session.user.id),
  })

  if (!user) {
    redirect('/login')
  }

  // Check if user email matches invitation email
  if (user.email.toLowerCase() !== invitation.email.toLowerCase()) {
    return (
      <InvitationContent
        type="email_mismatch"
        storeName={invitation.store.name}
        storeLogoUrl={invitation.store.logoUrl}
        invitedEmail={invitation.email}
        currentEmail={user.email}
      />
    )
  }

  // Check if already a member
  const existingMember = await db.query.storeMembers.findFirst({
    where: and(
      eq(storeMembers.storeId, invitation.storeId),
      eq(storeMembers.userId, session.user.id)
    ),
  })

  if (existingMember) {
    // Already a member, redirect to dashboard
    redirect('/dashboard')
  }

  // All checks passed - show accept button
  return (
    <InvitationContent
      type="ready"
      storeName={invitation.store.name}
      storeLogoUrl={invitation.store.logoUrl}
      inviterName={invitation.invitedByUser?.name || invitation.invitedByUser?.email || 'Un membre'}
      token={token}
    />
  )
}
