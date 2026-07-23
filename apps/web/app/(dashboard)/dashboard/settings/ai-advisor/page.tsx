import { redirect } from 'next/navigation'

/**
 * The AI assistant moved out of settings into its own page. Old links (emails,
 * bookmarks, the ?conversation= deep link) land here — forward them, query
 * string included.
 */
export default async function AiAdvisorSettingsRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === 'string') query.set(key, value)
    else if (Array.isArray(value)) for (const v of value) query.append(key, v)
  }
  const suffix = query.size > 0 ? `?${query.toString()}` : ''
  redirect(`/dashboard/ai-assistant${suffix}`)
}
