'use client'

export function RootError({ error }: { error: string | null }) {
  if (!error) return null

  return (
    <div className="rounded-lg bg-destructive/10 p-4 text-sm text-destructive">
      {error}
    </div>
  )
}
