'use client'

import { useRouter } from 'next/navigation'
import { useTransition, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useStore } from '@tanstack/react-form'

import { Button, Label } from '@louez/ui'
import { Input } from '@louez/ui'
import { Textarea } from '@louez/ui'
import { PhoneInput } from '@/components/ui/phone-input'
import { Switch } from '@louez/ui'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@louez/ui'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@louez/ui'
import { customerSchema, type CustomerInput } from '@louez/validations'
import { createCustomer, updateCustomer } from './actions'
import { useAppForm } from '@/hooks/form/form'
import { RootError } from '@/components/form/root-error'

interface Customer {
  id: string
  customerType: 'individual' | 'business'
  email: string
  firstName: string
  lastName: string
  companyName: string | null
  phone: string | null
  address: string | null
  city: string | null
  postalCode: string | null
  country: string | null
  notes: string | null
}

interface CustomerFormProps {
  customer?: Customer
}

const COUNTRY_CODES = ['FR', 'BE', 'CH', 'LU', 'MC', 'CA'] as const

export function CustomerForm({ customer }: CustomerFormProps) {
  const router = useRouter()
  const t = useTranslations('dashboard.customers.form')
  const tCountries = useTranslations('dashboard.customers.countries')
  const tCommon = useTranslations('common')
  const [isPending, startTransition] = useTransition()
  const isEditing = !!customer
  const [rootError, setRootError] = useState<string | null>(null)

  const form = useAppForm({
    defaultValues: {
      customerType: customer?.customerType || ('individual' as const),
      email: customer?.email || '',
      firstName: customer?.firstName || '',
      lastName: customer?.lastName || '',
      companyName: customer?.companyName || undefined,
      phone: customer?.phone || undefined,
      address: customer?.address || undefined,
      city: customer?.city || undefined,
      postalCode: customer?.postalCode || undefined,
      country: customer?.country || undefined,
      notes: customer?.notes || undefined,
    },
    onSubmit: async ({ value }) => {
      setRootError(null)

      // Validate with Zod
      const validation = customerSchema.safeParse(value)
      if (!validation.success) {
        const firstError = validation.error.issues[0]
        if (firstError) {
          setRootError(firstError.message)
        }
        return
      }

      startTransition(async () => {
        const result = isEditing
          ? await updateCustomer(customer.id, validation.data)
          : await createCustomer(validation.data)

        if (result.error) {
          setRootError(result.error)
          return
        }

        if (isEditing) {
          router.push(`/dashboard/customers/${customer.id}`)
        } else {
          router.push('/dashboard/customers')
        }
      })
    },
  })

  const customerType = useStore(form.store, (s) => s.values.customerType)

  return (
    <form onSubmit={(e) => { e.preventDefault(); e.stopPropagation(); form.handleSubmit() }} className="space-y-6">
      <RootError error={rootError} />

      <Card>
        <CardHeader>
          <CardTitle>{t('personalInfo')}</CardTitle>
          <CardDescription>
            {t('personalInfoDescription')}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {/* Business customer toggle */}
          <form.Field name="customerType">
            {(field) => (
              <div className="flex flex-row items-center justify-between rounded-lg border p-4">
                <div className="space-y-0.5">
                  <Label className="text-base">{t('businessCustomer')}</Label>
                  <p className="text-sm text-muted-foreground">
                    {t('businessCustomerDescription')}
                  </p>
                </div>
                <Switch
                  checked={field.state.value === 'business'}
                  onCheckedChange={(checked) => {
                    field.handleChange(checked ? 'business' : 'individual')
                    if (!checked) {
                      form.setFieldValue('companyName', undefined)
                    }
                  }}
                />
              </div>
            )}
          </form.Field>

          {/* Company name - only shown for business customers */}
          {customerType === 'business' && (
            <form.Field name="companyName">
              {(field) => (
                <div className="space-y-2">
                  <Label htmlFor={field.name}>{t('companyName')} *</Label>
                  <Input
                    id={field.name}
                    name={field.name}
                    value={field.state.value || ''}
                    onChange={(e) => field.handleChange(e.target.value || undefined)}
                    onBlur={field.handleBlur}
                    placeholder={t('companyNamePlaceholder')}
                  />
                  {field.state.meta.errors.length > 0 && (
                    <p className="text-sm font-medium text-destructive">
                      {field.state.meta.errors[0]}
                    </p>
                  )}
                </div>
              )}
            </form.Field>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <form.Field name="firstName">
              {(field) => (
                <div className="space-y-2">
                  <Label htmlFor={field.name}>{t('firstName')}</Label>
                  <Input
                    id={field.name}
                    name={field.name}
                    value={field.state.value || ''}
                    onChange={(e) => field.handleChange(e.target.value)}
                    onBlur={field.handleBlur}
                    placeholder={t('firstNamePlaceholder')}
                  />
                  {field.state.meta.errors.length > 0 && (
                    <p className="text-sm font-medium text-destructive">
                      {field.state.meta.errors[0]}
                    </p>
                  )}
                </div>
              )}
            </form.Field>

            <form.Field name="lastName">
              {(field) => (
                <div className="space-y-2">
                  <Label htmlFor={field.name}>{t('lastName')}</Label>
                  <Input
                    id={field.name}
                    name={field.name}
                    value={field.state.value || ''}
                    onChange={(e) => field.handleChange(e.target.value)}
                    onBlur={field.handleBlur}
                    placeholder={t('lastNamePlaceholder')}
                  />
                  {field.state.meta.errors.length > 0 && (
                    <p className="text-sm font-medium text-destructive">
                      {field.state.meta.errors[0]}
                    </p>
                  )}
                </div>
              )}
            </form.Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <form.Field name="email">
              {(field) => (
                <div className="space-y-2">
                  <Label htmlFor={field.name}>{t('email')}</Label>
                  <Input
                    id={field.name}
                    name={field.name}
                    type="email"
                    value={field.state.value || ''}
                    onChange={(e) => field.handleChange(e.target.value)}
                    onBlur={field.handleBlur}
                    placeholder={t('emailPlaceholder')}
                  />
                  {field.state.meta.errors.length > 0 && (
                    <p className="text-sm font-medium text-destructive">
                      {field.state.meta.errors[0]}
                    </p>
                  )}
                </div>
              )}
            </form.Field>

            <form.Field name="phone">
              {(field) => (
                <div className="space-y-2">
                  <Label htmlFor={field.name}>{t('phone')}</Label>
                  <PhoneInput
                    value={field.state.value || ''}
                    onChange={field.handleChange}
                    placeholder={t('phonePlaceholder')}
                  />
                  {field.state.meta.errors.length > 0 && (
                    <p className="text-sm font-medium text-destructive">
                      {field.state.meta.errors[0]}
                    </p>
                  )}
                </div>
              )}
            </form.Field>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('addressSection')}</CardTitle>
          <CardDescription>
            {t('addressDescription')}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <form.Field name="address">
            {(field) => (
              <div className="space-y-2">
                <Label htmlFor={field.name}>{t('address')}</Label>
                <Input
                  id={field.name}
                  name={field.name}
                  value={field.state.value || ''}
                  onChange={(e) => field.handleChange(e.target.value || undefined)}
                  onBlur={field.handleBlur}
                  placeholder={t('addressPlaceholder')}
                />
                {field.state.meta.errors.length > 0 && (
                  <p className="text-sm font-medium text-destructive">
                    {field.state.meta.errors[0]}
                  </p>
                )}
              </div>
            )}
          </form.Field>

          <div className="grid gap-4 sm:grid-cols-3">
            <form.Field name="postalCode">
              {(field) => (
                <div className="space-y-2">
                  <Label htmlFor={field.name}>{t('postalCode')}</Label>
                  <Input
                    id={field.name}
                    name={field.name}
                    value={field.state.value || ''}
                    onChange={(e) => field.handleChange(e.target.value || undefined)}
                    onBlur={field.handleBlur}
                    placeholder={t('postalCodePlaceholder')}
                  />
                  {field.state.meta.errors.length > 0 && (
                    <p className="text-sm font-medium text-destructive">
                      {field.state.meta.errors[0]}
                    </p>
                  )}
                </div>
              )}
            </form.Field>

            <form.Field name="city">
              {(field) => (
                <div className="space-y-2">
                  <Label htmlFor={field.name}>{t('city')}</Label>
                  <Input
                    id={field.name}
                    name={field.name}
                    value={field.state.value || ''}
                    onChange={(e) => field.handleChange(e.target.value || undefined)}
                    onBlur={field.handleBlur}
                    placeholder={t('cityPlaceholder')}
                  />
                  {field.state.meta.errors.length > 0 && (
                    <p className="text-sm font-medium text-destructive">
                      {field.state.meta.errors[0]}
                    </p>
                  )}
                </div>
              )}
            </form.Field>

            <form.Field name="country">
              {(field) => (
                <div className="space-y-2">
                  <Label htmlFor={field.name}>{t('country')}</Label>
                  <Select
                    value={field.state.value || undefined}
                    onValueChange={(value) => { if (value !== null) field.handleChange(value || undefined) }}
                  >
                    <SelectTrigger id={field.name}>
                      <SelectValue placeholder={t('selectCountry')} />
                    </SelectTrigger>
                    <SelectContent>
                      {COUNTRY_CODES.map((code) => (
                        <SelectItem key={code} value={code}>
                          {tCountries(code)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {field.state.meta.errors.length > 0 && (
                    <p className="text-sm font-medium text-destructive">
                      {field.state.meta.errors[0]}
                    </p>
                  )}
                </div>
              )}
            </form.Field>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('internalNotes')}</CardTitle>
          <CardDescription>
            {t('internalNotesDescription')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form.Field name="notes">
            {(field) => (
              <div className="space-y-2">
                <Textarea
                  id={field.name}
                  name={field.name}
                  value={field.state.value || ''}
                  onChange={(e) => field.handleChange(e.target.value || undefined)}
                  onBlur={field.handleBlur}
                  placeholder={t('notesPlaceholder')}
                  rows={4}
                />
                {field.state.meta.errors.length > 0 && (
                  <p className="text-sm font-medium text-destructive">
                    {field.state.meta.errors[0]}
                  </p>
                )}
              </div>
            )}
          </form.Field>
        </CardContent>
      </Card>

      <div className="flex justify-end gap-4">
        <Button
          type="button"
          variant="outline"
          onClick={() => router.back()}
        >
          {tCommon('cancel')}
        </Button>
        <Button type="submit" disabled={isPending}>
          {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {isEditing ? t('save') : t('createCustomer')}
        </Button>
      </div>
    </form>
  )
}
