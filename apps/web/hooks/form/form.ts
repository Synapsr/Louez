import { createFormHook } from '@tanstack/react-form'
import { fieldContext, formContext } from './form-context'
import { FormInput } from '@/components/form/form-input'
import { FormTextarea } from '@/components/form/form-textarea'
import { FormSwitch } from '@/components/form/form-switch'
import { FormSelect } from '@/components/form/form-select'
import { FormCheckbox } from '@/components/form/form-checkbox'
import { FormPriceDuration } from '@/components/form/form-price-duration'
import { FormReservationDatePicker } from '@/components/form/form-reservation-date-picker'
import { FormOtp } from '@/components/form/form-otp'
import { FormImageUpload } from '@/components/form/form-image-upload'
import { FormPhoneInput } from '@/components/form/form-phone-input'
import { FormCountrySelect } from '@/components/form/form-country-select'
import { FormCurrencySelect } from '@/components/form/form-currency-select'
import { SubscribeButton } from '@/components/form/subscribe-button'
import { FormForm } from '@/components/form/form-form'

export const { useAppForm, withForm } = createFormHook({
  fieldComponents: {
    Input: FormInput,
    Textarea: FormTextarea,
    Switch: FormSwitch,
    Select: FormSelect,
    Checkbox: FormCheckbox,
    Otp: FormOtp,
    ImageUpload: FormImageUpload,
    PhoneInput: FormPhoneInput,
    CountrySelect: FormCountrySelect,
    CurrencySelect: FormCurrencySelect,
    PriceDuration: FormPriceDuration,
    ReservationDatePicker: FormReservationDatePicker,
  },
  formComponents: {
    Form: FormForm,
    SubscribeButton,
  },
  fieldContext,
  formContext,
})

export type AppForm = ReturnType<typeof useAppForm>
