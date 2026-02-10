'use client'

import { useFormContext } from '@/hooks/form/form-context'

export function FormForm({
  children,
  ...props
}: React.ComponentProps<'form'>) {
  const form = useFormContext()

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        e.stopPropagation()
        form.handleSubmit()
      }}
      {...props}
    >
      {children}
    </form>
  )
}
