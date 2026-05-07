'use client'

import { useFormContext } from '@/hooks/form/form-context'
import { Button } from '@louez/ui'

export function SubscribeButton({
  children,
  ...props
}: React.ComponentProps<typeof Button>) {
  const form = useFormContext()

  return (
    <form.Subscribe selector={(state) => state.isSubmitting}>
      {(isSubmitting) => (
        <Button type="submit" isPending={isSubmitting} {...props}>
          {children}
        </Button>
      )}
    </form.Subscribe>
  )
}
