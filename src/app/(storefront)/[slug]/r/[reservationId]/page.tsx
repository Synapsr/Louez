import { redirect } from 'next/navigation'
import { validateInstantAccessToken } from '../actions'

interface InstantAccessPageProps {
  params: Promise<{ slug: string; reservationId: string }>
  searchParams: Promise<{ token?: string }>
}

export default async function InstantAccessPage({
  params,
  searchParams,
}: InstantAccessPageProps) {
  const { slug, reservationId } = await params
  const { token } = await searchParams

  if (!token) {
    // No token provided, redirect to login with redirect back to reservation
    // Note: Don't include slug in path - subdomain routing handles it
    redirect(`/account/login?redirect=/account/reservations/${reservationId}`)
  }

  const result = await validateInstantAccessToken(slug, reservationId, token)

  if (result.error) {
    // Token invalid or expired, redirect to login with error
    // Note: Don't include slug in path - subdomain routing handles it
    redirect(
      `/account/login?error=invalidToken&redirect=/account/reservations/${reservationId}`
    )
  }

  // Token valid, session created, redirect to reservation detail
  redirect(result.redirectUrl!)
}
