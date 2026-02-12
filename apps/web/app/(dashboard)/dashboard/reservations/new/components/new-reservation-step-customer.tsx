'use client'

import { User, UserPlus } from 'lucide-react'
import { useTranslations } from 'next-intl'

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Label,
  RadioGroup,
  RadioGroupItem,
} from '@louez/ui'
import { cn } from '@louez/utils'

import { CustomerCombobox } from '@/components/dashboard/customer-combobox'

import type {
  Customer,
  NewReservationFormComponentApi,
  NewReservationFormValues,
  StepFieldName,
} from '../types'

interface NewReservationStepCustomerProps {
  form: NewReservationFormComponentApi
  customers: Customer[]
  customerType: NewReservationFormValues['customerType']
  clearStepFieldError: (name: StepFieldName) => void
  getFieldErrorMessage: (error: unknown) => string
}

export function NewReservationStepCustomer({
  form,
  customers,
  customerType,
  clearStepFieldError,
  getFieldErrorMessage,
}: NewReservationStepCustomerProps) {
  const t = useTranslations('dashboard.reservations.manualForm')

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <User className="h-5 w-5" />
          {t('customer')}
        </CardTitle>
        <CardDescription>{t('customerStepDescription')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <form.Field name="customerType">
          {(field) => (
            <RadioGroup
              onValueChange={(value) => field.handleChange(value as 'existing' | 'new')}
              defaultValue={field.state.value}
              className="grid grid-cols-1 gap-4 sm:grid-cols-2"
            >
              <label
                htmlFor="existing"
                className={cn(
                  'flex cursor-pointer items-center space-x-4 rounded-lg border p-4 transition-colors',
                  field.state.value === 'existing'
                    ? 'border-primary bg-primary/5'
                    : 'hover:bg-muted/50',
                  customers.length === 0 && 'cursor-not-allowed opacity-50'
                )}
              >
                <RadioGroupItem
                  value="existing"
                  id="existing"
                  disabled={customers.length === 0}
                />
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <User className="h-4 w-4" />
                    <span className="font-medium">{t('existingCustomer')}</span>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {t('existingCustomerDescription')}
                  </p>
                </div>
              </label>

              <label
                htmlFor="new"
                className={cn(
                  'flex cursor-pointer items-center space-x-4 rounded-lg border p-4 transition-colors',
                  field.state.value === 'new'
                    ? 'border-primary bg-primary/5'
                    : 'hover:bg-muted/50'
                )}
              >
                <RadioGroupItem value="new" id="new" />
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <UserPlus className="h-4 w-4" />
                    <span className="font-medium">{t('newCustomer')}</span>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {t('newCustomerDescription')}
                  </p>
                </div>
              </label>
            </RadioGroup>
          )}
        </form.Field>

        {customerType === 'existing' && customers.length > 0 && (
          <form.Field name="customerId">
            {(field) => (
              <div className="space-y-2">
                <Label>{t('selectCustomer')}</Label>
                <CustomerCombobox
                  customers={customers}
                  value={field.state.value}
                  onValueChange={(value) => {
                    field.handleChange(value)
                    clearStepFieldError('customerId')
                  }}
                />
                {field.state.meta.errors.length > 0 && (
                  <p className="text-sm font-medium text-destructive">
                    {getFieldErrorMessage(field.state.meta.errors[0])}
                  </p>
                )}
              </div>
            )}
          </form.Field>
        )}

        {customerType === 'new' && (
          <div className="space-y-4">
            <form.AppField name="email">
              {(field) => (
                <field.Input
                  label={`${t('email')} *`}
                  type="email"
                  placeholder={t('emailPlaceholder')}
                />
              )}
            </form.AppField>
            <div className="grid gap-4 sm:grid-cols-2">
              <form.AppField name="firstName">
                {(field) => (
                  <field.Input
                    label={`${t('firstName')} *`}
                    placeholder={t('firstNamePlaceholder')}
                  />
                )}
              </form.AppField>
              <form.AppField name="lastName">
                {(field) => (
                  <field.Input
                    label={`${t('lastName')} *`}
                    placeholder={t('lastNamePlaceholder')}
                  />
                )}
              </form.AppField>
            </div>
            <form.AppField name="phone">
              {(field) => <field.Input label={t('phone')} placeholder={t('phonePlaceholder')} />}
            </form.AppField>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
