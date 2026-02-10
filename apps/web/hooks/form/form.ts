import { createFormHook } from '@tanstack/react-form'
import { fieldContext, formContext } from './form-context'
import { FormInput } from '@/components/form/form-input'
import { FormTextarea } from '@/components/form/form-textarea'
import { FormSwitch } from '@/components/form/form-switch'
import { SubscribeButton } from '@/components/form/subscribe-button'
import { FormForm } from '@/components/form/form-form'

export const { useAppForm, withForm } = createFormHook({
  fieldComponents: {
    Input: FormInput,
    Textarea: FormTextarea,
    Switch: FormSwitch,
  },
  formComponents: {
    Form: FormForm,
    SubscribeButton,
  },
  fieldContext,
  formContext,
})

export type AppForm = ReturnType<typeof useAppForm>
