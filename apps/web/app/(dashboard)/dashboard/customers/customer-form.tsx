'use client'

import { useEffect } from 'react'

import { useStore } from '@tanstack/react-form'
import { Building2, User } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'

import type {
  CustomerFieldDefinition,
  CustomerFieldValues,
  ResolvedCustomerProfileSettings,
} from '@louez/types'
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Label,
} from '@louez/ui'

import { RootError } from '@/components/form/root-error'
import { PanelSegmentedControl } from '@/components/online-store/panel/panel-segmented-control'
import { trackOpenReplayEvent } from '@/lib/openreplay/client'
import { openReplayEvents } from '@/lib/openreplay/events'

import { CustomerFormAdditionalInfo } from './customer-form-additional-info'
import type { CustomerFormCustomer, CustomerFormOpenReplaySource } from './customer-form.types'
import { useCustomerForm } from './use-customer-form'

interface CustomerFormProps {
  customer?: CustomerFormCustomer
  definitions: CustomerFieldDefinition[]
  initialCustomFields?: CustomerFieldValues
  profileSettings: ResolvedCustomerProfileSettings
  /** Owners get a shortcut to the field editor. */
  canCustomize: boolean
  openReplaySource?: CustomerFormOpenReplaySource
}

export function CustomerForm({
  customer,
  definitions,
  initialCustomFields = {},
  profileSettings,
  canCustomize,
  openReplaySource = 'direct',
}: CustomerFormProps) {
  const router = useRouter()
  const t = useTranslations('dashboard.customers.form')
  const tCustomers = useTranslations('dashboard.customers')
  const tCommon = useTranslations('common')
  const { form, rootError, fieldIssues, isEditing } = useCustomerForm({
    customer,
    initialCustomFields,
    profileSettings,
    openReplaySource,
  })

  useEffect(() => {
    if (isEditing) return

    trackOpenReplayEvent(openReplayEvents.dashboardCustomerCreationStarted, {
      journey: 'customer_creation',
      step: 'started',
      source: openReplaySource,
    })
  }, [isEditing, openReplaySource])

  const customerType = useStore(form.store, (state) => state.values.customerType)
  const country = useStore(form.store, (state) => state.values.country)

  const companyNumberLabel =
    country === 'FR'
      ? t('companyNumberSiren')
      : country === 'BE'
        ? t('companyNumberBce')
        : t('companyNumber')

  return (
    <form.AppForm>
      <form.Form className="space-y-4 sm:space-y-6">
        <RootError error={rootError} />

        <Card>
          <CardHeader>
            <CardTitle>{t('personalInfo')}</CardTitle>
            <CardDescription>{t('personalInfoDescription')}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <form.Field name="customerType">
              {(field) => (
                <div className="space-y-2 sm:max-w-sm">
                  <Label>{t('customerKind')}</Label>
                  <PanelSegmentedControl
                    aria-label={t('customerKind')}
                    value={field.state.value}
                    onChange={field.handleChange}
                    options={[
                      {
                        value: 'individual',
                        label: tCustomers('customerType.individual'),
                        icon: User,
                      },
                      {
                        value: 'business',
                        label: tCustomers('customerType.business'),
                        icon: Building2,
                      },
                    ]}
                  />
                </div>
              )}
            </form.Field>

            {customerType === 'business' && (
              <>
                <form.AppField name="companyName">
                  {(field) => (
                    <field.Input
                      label={`${t('companyName')} *`}
                      placeholder={t('companyNamePlaceholder')}
                    />
                  )}
                </form.AppField>
                <div className="grid gap-4 sm:grid-cols-2">
                  <form.AppField name="companyNumber">
                    {(field) => (
                      <field.Input
                        label={companyNumberLabel}
                        placeholder={t('companyNumberPlaceholder')}
                        description={t('companyNumberHelp')}
                      />
                    )}
                  </form.AppField>
                  <form.AppField name="vatNumber">
                    {(field) => (
                      <field.Input label={t('vatNumber')} placeholder={t('vatNumberPlaceholder')} />
                    )}
                  </form.AppField>
                </div>
              </>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <form.AppField name="firstName">
                {(field) => (
                  <field.Input
                    label={t('firstName')}
                    placeholder={t('firstNamePlaceholder')}
                    autoComplete="off"
                  />
                )}
              </form.AppField>
              <form.AppField name="lastName">
                {(field) => (
                  <field.Input
                    label={t('lastName')}
                    placeholder={t('lastNamePlaceholder')}
                    autoComplete="off"
                  />
                )}
              </form.AppField>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <form.AppField name="email">
                {(field) => (
                  <field.Input
                    type="email"
                    label={t('email')}
                    placeholder={t('emailPlaceholder')}
                    autoComplete="off"
                  />
                )}
              </form.AppField>
              <form.AppField name="phone">
                {(field) => <field.PhoneInput label={t('phone')} />}
              </form.AppField>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('addressSection')}</CardTitle>
            <CardDescription>{t('addressDescription')}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <form.AppField name="address">
              {(field) => <field.Input label={t('address')} placeholder={t('addressPlaceholder')} />}
            </form.AppField>
            <div className="grid gap-4 sm:grid-cols-3">
              <form.AppField name="postalCode">
                {(field) => (
                  <field.Input label={t('postalCode')} placeholder={t('postalCodePlaceholder')} />
                )}
              </form.AppField>
              <form.AppField name="city">
                {(field) => <field.Input label={t('city')} placeholder={t('cityPlaceholder')} />}
              </form.AppField>
              <form.AppField name="country">
                {(field) => (
                  <field.CountrySelect label={t('country')} placeholder={t('selectCountry')} />
                )}
              </form.AppField>
            </div>
          </CardContent>
        </Card>

        <CustomerFormAdditionalInfo
          form={form}
          definitions={definitions}
          profileSettings={profileSettings}
          fieldIssues={fieldIssues}
          customerId={customer?.id}
          canCustomize={canCustomize}
        />

        <Card>
          <CardHeader>
            <CardTitle>{t('internalNotes')}</CardTitle>
            <CardDescription>{t('internalNotesDescription')}</CardDescription>
          </CardHeader>
          <CardContent>
            <form.AppField name="notes">
              {(field) => <field.Textarea rows={4} placeholder={t('notesPlaceholder')} />}
            </form.AppField>
          </CardContent>
        </Card>

        <div className="flex justify-end gap-3">
          <Button type="button" variant="outline" onClick={() => router.back()}>
            {tCommon('cancel')}
          </Button>
          <form.SubscribeButton>{isEditing ? t('save') : t('createCustomer')}</form.SubscribeButton>
        </div>
      </form.Form>
    </form.AppForm>
  )
}
