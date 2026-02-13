import { redirect } from 'next/navigation'
import { getCurrentStore } from '@/lib/store-context'

export default async function RootPage() {
  const store = await getCurrentStore()

  // Redirect to onboarding if no store or not set up
  if (!store?.onboardingCompleted) {
    redirect('/onboarding')
  }

  // Redirect to dashboard home
  redirect('/dashboard')
}
