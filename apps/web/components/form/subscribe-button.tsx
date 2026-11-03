'use client'

import { useFormContext } from '@/hooks/form/form-context'
import { Button } from '@louez/ui'

/**
 * Submit button that shows the form's submission state. `isPending` adds work
 * that outlives the submit handler, such as the navigation that follows it.
 */
export function SubscribeButton({
  children,
  isPending = false,
  ...props
}: React.ComponentProps<typeof Button>) {
  const form = useFormContext()

  return (
    <form.Subscribe selector={(state) => state.isSubmitting}>
      {(isSubmitting) => (
        <Button type="submit" isPending={isSubmitting || isPending} {...props}>
          {children}
        </Button>
      )}
    </form.Subscribe>
  )
}
