'use client'

import { useFormContext } from '@/hooks/form/form-context'
import { Button } from '@louez/ui'
import { Loader2 } from 'lucide-react'

export function SubscribeButton({
  children,
  ...props
}: React.ComponentProps<typeof Button>) {
  const form = useFormContext()

  return (
    <form.Subscribe selector={(state) => state.isSubmitting}>
      {(isSubmitting) => (
        <Button type="submit" disabled={isSubmitting} {...props}>
          {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {children}
        </Button>
      )}
    </form.Subscribe>
  )
}
