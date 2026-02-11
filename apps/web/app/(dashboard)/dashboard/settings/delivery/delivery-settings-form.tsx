'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { z } from 'zod'
import { Info, Truck, AlertTriangle, MapPin, Calculator, Search, Package, Gift } from 'lucide-react'
import Link from 'next/link'
import { toastManager } from '@louez/ui'
import { useStore } from '@tanstack/react-form'

import { Button } from '@louez/ui'
import { Input } from '@louez/ui'
import { Switch } from '@louez/ui'
import { Alert, AlertDescription } from '@louez/ui'
import { Label } from '@louez/ui'
import { Slider } from '@louez/ui'
import {
  Dialog,
  DialogPopup,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogPanel,
} from '@louez/ui'
import { AddressInput } from '@/components/ui/address-input'
import { calculateHaversineDistance } from '@/lib/utils/geo'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@louez/ui'
import { RadioGroup, RadioGroupItem } from '@louez/ui'
import { updateDeliverySettings } from './actions'
import { FloatingSaveBar } from '@/components/dashboard/floating-save-bar'
import { formatCurrency } from '@louez/utils'
import type { StoreSettings, DeliverySettings, DeliveryMode } from '@louez/types'
import { useAppForm } from '@/hooks/form/form'
import { RootError } from '@/components/form/root-error'

const DELIVERY_MODES = ['optional', 'required', 'included'] as const

const createDeliverySettingsSchema = (
  t: (key: string, params?: Record<string, string | number | Date>) => string
) =>
  z.object({
    enabled: z.boolean(),
    mode: z.enum(DELIVERY_MODES),
    pricePerKm: z
      .number()
      .min(0, t('minValue', { min: 0 }))
      .max(100, t('maxValue', { max: 100 })),
    roundTrip: z.boolean(),
    minimumFee: z
      .number()
      .min(0, t('minValue', { min: 0 }))
      .max(1000, t('maxValue', { max: 1000 })),
    maximumDistance: z
      .number()
      .min(1, t('minValue', { min: 1 }))
      .max(500, t('maxValue', { max: 500 }))
      .nullable(),
    freeDeliveryThreshold: z
      .number()
      .min(0, t('minValue', { min: 0 }))
      .max(100000, t('maxValue', { max: 100000 }))
      .nullable(),
  })

type DeliverySettingsInput = z.infer<
  ReturnType<typeof createDeliverySettingsSchema>
>

interface Store {
  id: string
  settings: StoreSettings | null
  latitude: string | null
  longitude: string | null
}

interface DeliverySettingsFormProps {
  store: Store
  hasCoordinates: boolean
}

export function DeliverySettingsForm({
  store,
  hasCoordinates,
}: DeliverySettingsFormProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const t = useTranslations('dashboard.settings.delivery')
  const currency = store.settings?.currency || 'EUR'
  const tValidation = useTranslations('validation')
  const tCommon = useTranslations('common')

  const deliverySettingsSchema = createDeliverySettingsSchema(tValidation)

  const currentDelivery: DeliverySettings = store.settings?.delivery || {
    enabled: false,
    mode: 'optional',
    pricePerKm: 1.5,
    roundTrip: false,
    minimumFee: 10,
    maximumDistance: null,
    freeDeliveryThreshold: null,
  }

  const [rootError, setRootError] = useState<string | null>(null)
  const form = useAppForm({
    defaultValues: {
      enabled: currentDelivery.enabled,
      mode: currentDelivery.mode || 'optional',
      pricePerKm: currentDelivery.pricePerKm,
      roundTrip: currentDelivery.roundTrip,
      minimumFee: currentDelivery.minimumFee,
      maximumDistance: currentDelivery.maximumDistance,
      freeDeliveryThreshold: currentDelivery.freeDeliveryThreshold,
    },
    validators: { onSubmit: deliverySettingsSchema },
    onSubmit: async ({ value }) => {
      setRootError(null)
      startTransition(async () => {
        const result = await updateDeliverySettings(value)
        if (result.error) {
          if (result.error === 'errors.storeCoordinatesRequired') {
            toastManager.add({ title: t('noCoordinatesError'), type: 'error' })
          } else {
            setRootError(result.error)
          }
          return
        }
        toastManager.add({ title: t('saved'), type: 'success' })
        router.refresh()
      })
    },
  })

  const isDirty = useStore(form.store, (s) => s.isDirty)

  const isEnabled = useStore(form.store, (s) => s.values.enabled)
  const mode = useStore(form.store, (s) => s.values.mode)
  const pricePerKm = useStore(form.store, (s) => s.values.pricePerKm)
  const roundTrip = useStore(form.store, (s) => s.values.roundTrip)
  const minimumFee = useStore(form.store, (s) => s.values.minimumFee)
  const maximumDistance = useStore(form.store, (s) => s.values.maximumDistance)
  const freeDeliveryThreshold = useStore(form.store, (s) => s.values.freeDeliveryThreshold)

  // Pricing is only relevant when mode is not 'included'
  const showPricing = mode !== 'included'

  // Simulator state
  const [simDistance, setSimDistance] = useState(10)
  const [simOrderTotal, setSimOrderTotal] = useState(100)
  const [isAddressDialogOpen, setIsAddressDialogOpen] = useState(false)
  const [testAddress, setTestAddress] = useState('')

  // Store coordinates for distance calculation
  const storeLatitude = store.latitude ? parseFloat(store.latitude) : null
  const storeLongitude = store.longitude ? parseFloat(store.longitude) : null

  // Calculate example delivery cost
  const getExampleCost = (distance: number) => {
    const effectiveDistance = roundTrip ? distance * 2 : distance
    const cost = effectiveDistance * pricePerKm
    return Math.max(cost, minimumFee)
  }

  // Calculate simulated delivery fee
  const getSimulatedFee = () => {
    // Check if free delivery applies
    if (freeDeliveryThreshold && simOrderTotal >= freeDeliveryThreshold) {
      return { fee: 0, isFree: true, reason: 'threshold' as const }
    }

    // Check if distance exceeds maximum
    if (maximumDistance && simDistance > maximumDistance) {
      return { fee: 0, isFree: false, reason: 'tooFar' as const }
    }

    // Calculate fee
    const effectiveDistance = roundTrip ? simDistance * 2 : simDistance
    const calculatedFee = effectiveDistance * pricePerKm
    const fee = Math.max(calculatedFee, minimumFee)

    return { fee, isFree: false, reason: 'calculated' as const }
  }

  const simResult = getSimulatedFee()

  // Handle address selection for testing
  const handleTestAddressChange = (
    address: string,
    latitude: number | null,
    longitude: number | null
  ) => {
    setTestAddress(address)

    if (latitude && longitude && storeLatitude && storeLongitude) {
      const distance = calculateHaversineDistance(
        storeLatitude,
        storeLongitude,
        latitude,
        longitude
      )
      setSimDistance(Math.round(distance * 10) / 10)
      setIsAddressDialogOpen(false)
    }
  }

  return (
    <form.AppForm>
      <form.Form className="space-y-6">
        <RootError error={rootError} />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Truck className="h-5 w-5" />
            {t('enableSection')}
          </CardTitle>
          <CardDescription>{t('enableSectionDescription')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Warning if no coordinates */}
          {!hasCoordinates && (
            <Alert variant="error">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription className="flex items-center justify-between">
                <span>{t('noCoordinatesWarning')}</span>
                <Button variant="outline" render={<Link href="/dashboard/settings" />}>
                    <MapPin className="mr-2 h-4 w-4" />
                    {t('goToStoreSettings')}
                </Button>
              </AlertDescription>
            </Alert>
          )}

          {/* Enable Switch */}
          <form.AppField name="enabled">
            {(field) => (
              <field.Switch
                label={t('enabled')}
                description={t('enabledDescription')}
                disabled={!hasCoordinates}
              />
            )}
          </form.AppField>

          {/* Delivery Mode Selection */}
          {isEnabled && (
            <form.Field name="mode">
              {(field) => (
                <div className="grid gap-2">
                  <Label htmlFor={field.name}>{t('modeSection')}</Label>
                  <RadioGroup
                    value={field.state.value}
                    onValueChange={(val) => field.handleChange(val)}
                    className="grid gap-3 sm:grid-cols-3"
                  >
                    {/* Optional - Customer chooses */}
                    <label
                      htmlFor="mode-optional"
                      className={`relative flex flex-col gap-2 rounded-lg border p-4 cursor-pointer transition-colors ${
                        field.state.value === 'optional'
                          ? 'border-primary bg-primary/5 ring-1 ring-primary'
                          : 'hover:bg-muted/50'
                      }`}
                    >
                      <RadioGroupItem value="optional" id="mode-optional" className="sr-only" />
                      <div className="flex items-center gap-2">
                        <Package className="h-4 w-4 text-muted-foreground" />
                        <span className="font-medium text-sm">{t('modeOptional')}</span>
                      </div>
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        {t('modeOptionalDescription')}
                      </p>
                    </label>

                    {/* Required - Delivery mandatory */}
                    <label
                      htmlFor="mode-required"
                      className={`relative flex flex-col gap-2 rounded-lg border p-4 cursor-pointer transition-colors ${
                        field.state.value === 'required'
                          ? 'border-primary bg-primary/5 ring-1 ring-primary'
                          : 'hover:bg-muted/50'
                      }`}
                    >
                      <RadioGroupItem value="required" id="mode-required" className="sr-only" />
                      <div className="flex items-center gap-2">
                        <Truck className="h-4 w-4 text-muted-foreground" />
                        <span className="font-medium text-sm">{t('modeRequired')}</span>
                      </div>
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        {t('modeRequiredDescription')}
                      </p>
                    </label>

                    {/* Included - Free delivery mandatory */}
                    <label
                      htmlFor="mode-included"
                      className={`relative flex flex-col gap-2 rounded-lg border p-4 cursor-pointer transition-colors ${
                        field.state.value === 'included'
                          ? 'border-primary bg-primary/5 ring-1 ring-primary'
                          : 'hover:bg-muted/50'
                      }`}
                    >
                      <RadioGroupItem value="included" id="mode-included" className="sr-only" />
                      <div className="flex items-center gap-2">
                        <Gift className="h-4 w-4 text-muted-foreground" />
                        <span className="font-medium text-sm">{t('modeIncluded')}</span>
                      </div>
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        {t('modeIncludedDescription')}
                      </p>
                    </label>
                  </RadioGroup>
                  {field.state.meta.errors.length > 0 && <p className="text-destructive text-sm">{String(field.state.meta.errors[0])}</p>}
                </div>
              )}
            </form.Field>
          )}

          {/* Customer address note */}
          {isEnabled && (
            <div className="flex items-start gap-3 rounded-lg bg-blue-50 dark:bg-blue-950/30 p-4 text-sm">
              <Info className="h-4 w-4 mt-0.5 text-blue-600 dark:text-blue-400 shrink-0" />
              <p className="text-blue-700 dark:text-blue-300">
                {mode === 'optional' ? t('customerAddressNoteOptional') : t('customerAddressNoteRequired')}
              </p>
            </div>
          )}

          {/* Configuration - Only when enabled and pricing is relevant */}
          {isEnabled && showPricing && (
            <div className="space-y-6 border-t pt-6">
              {/* Pricing Section */}
              <div>
                <h3 className="text-sm font-medium mb-4">
                  {t('pricingSection')}
                </h3>
                <div className="grid gap-6 sm:grid-cols-2">
                  {/* Price per km */}
                  <form.Field name="pricePerKm">
                    {(field) => (
                      <div className="grid gap-2">
                        <Label htmlFor={field.name}>{t('pricePerKm')}</Label>
                        <div className="flex items-center gap-2">
                          <Input
                            id={field.name}
                            type="number"
                            min={0}
                            max={100}
                            step={0.1}
                            value={field.state.value}
                            onChange={(e) =>
                              field.handleChange(parseFloat(e.target.value) || 0)
                            }
                            onBlur={field.handleBlur}
                            className="w-24"
                          />
                          <span className="text-sm text-muted-foreground">
                            {currency}/km
                          </span>
                        </div>
                        <p className="text-muted-foreground text-sm">
                          {t('pricePerKmDescription')}
                        </p>
                        {field.state.meta.errors.length > 0 && <p className="text-destructive text-sm">{String(field.state.meta.errors[0])}</p>}
                      </div>
                    )}
                  </form.Field>

                  {/* Minimum fee */}
                  <form.Field name="minimumFee">
                    {(field) => (
                      <div className="grid gap-2">
                        <Label htmlFor={field.name}>{t('minimumFee')}</Label>
                        <div className="flex items-center gap-2">
                          <Input
                            id={field.name}
                            type="number"
                            min={0}
                            max={1000}
                            step={0.5}
                            value={field.state.value}
                            onChange={(e) =>
                              field.handleChange(parseFloat(e.target.value) || 0)
                            }
                            onBlur={field.handleBlur}
                            className="w-24"
                          />
                          <span className="text-sm text-muted-foreground">
                            {currency}
                          </span>
                        </div>
                        <p className="text-muted-foreground text-sm">
                          {t('minimumFeeDescription')}
                        </p>
                        {field.state.meta.errors.length > 0 && <p className="text-destructive text-sm">{String(field.state.meta.errors[0])}</p>}
                      </div>
                    )}
                  </form.Field>
                </div>
              </div>

              {/* Round Trip Option */}
              <form.Field name="roundTrip">
                {(field) => (
                  <div className="grid gap-2">
                    <Label htmlFor={field.name}>{t('tripType')}</Label>
                    <RadioGroup
                      value={String(field.state.value)}
                      onValueChange={(value) =>
                        field.handleChange(value === 'true')
                      }
                      className="grid gap-2 sm:grid-cols-2"
                    >
                      <label
                        htmlFor="oneWay"
                        className={`flex items-center gap-3 rounded-lg border p-3 cursor-pointer transition-colors ${
                          !field.state.value
                            ? 'border-primary bg-primary/5'
                            : 'hover:bg-muted/50'
                        }`}
                      >
                        <RadioGroupItem value="false" id="oneWay" />
                        <div className="grid gap-0.5">
                          <span className="font-medium text-sm">
                            {t('oneWay')}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {t('oneWayDescription')}
                          </span>
                        </div>
                      </label>
                      <label
                        htmlFor="roundTrip"
                        className={`flex items-center gap-3 rounded-lg border p-3 cursor-pointer transition-colors ${
                          field.state.value
                            ? 'border-primary bg-primary/5'
                            : 'hover:bg-muted/50'
                        }`}
                      >
                        <RadioGroupItem value="true" id="roundTrip" />
                        <div className="grid gap-0.5">
                          <span className="font-medium text-sm">
                            {t('roundTrip')}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {t('roundTripDescription')}
                          </span>
                        </div>
                      </label>
                    </RadioGroup>
                    {field.state.meta.errors.length > 0 && <p className="text-destructive text-sm">{String(field.state.meta.errors[0])}</p>}
                  </div>
                )}
              </form.Field>

              {/* Example calculation */}
              <div className="flex items-start gap-3 rounded-lg bg-muted/50 p-4 text-sm">
                <Info className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                <div className="text-muted-foreground">
                  <p className="font-medium text-foreground mb-1">
                    {t('exampleTitle')}
                  </p>
                  <p>
                    {t('example', {
                      distance: 15,
                      fee: formatCurrency(getExampleCost(15), currency),
                    })}
                  </p>
                  {roundTrip && (
                    <p className="text-xs mt-1 opacity-75">
                      {t('roundTripNote', { distance: 15, total: 30 })}
                    </p>
                  )}
                </div>
              </div>

              {/* Optional Settings */}
              <div className="border-t pt-6">
                <p className="text-sm font-medium mb-4 text-muted-foreground">
                  {t('optionalSection')}
                </p>
                <div className="grid gap-4 sm:grid-cols-2">
                  {/* Maximum distance */}
                  <form.Field name="maximumDistance">
                    {(field) => (
                      <div className="grid gap-2">
                        <Label htmlFor={field.name} className="flex items-center gap-2">
                          {t('maximumDistance')}
                          <span className="text-xs text-muted-foreground font-normal">
                            ({tCommon('optional')})
                          </span>
                        </Label>
                        <div className="flex items-center gap-2">
                          <Input
                            id={field.name}
                            type="number"
                            min={1}
                            max={500}
                            placeholder="-"
                            value={field.state.value ?? ''}
                            onChange={(e) => {
                              const val = e.target.value
                              field.handleChange(
                                val === '' ? null : parseFloat(val)
                              )
                            }}
                            onBlur={field.handleBlur}
                            className="w-24"
                          />
                          <span className="text-sm text-muted-foreground">
                            km
                          </span>
                        </div>
                        <p className="text-muted-foreground text-sm">
                          {t('maximumDistanceDescription')}
                        </p>
                        {field.state.meta.errors.length > 0 && <p className="text-destructive text-sm">{String(field.state.meta.errors[0])}</p>}
                      </div>
                    )}
                  </form.Field>

                  {/* Free delivery threshold */}
                  <form.Field name="freeDeliveryThreshold">
                    {(field) => (
                      <div className="grid gap-2">
                        <Label htmlFor={field.name} className="flex items-center gap-2">
                          {t('freeDeliveryThreshold')}
                          <span className="text-xs text-muted-foreground font-normal">
                            ({tCommon('optional')})
                          </span>
                        </Label>
                        <div className="flex items-center gap-2">
                          <Input
                            id={field.name}
                            type="number"
                            min={0}
                            max={100000}
                            placeholder="-"
                            value={field.state.value ?? ''}
                            onChange={(e) => {
                              const val = e.target.value
                              field.handleChange(
                                val === '' ? null : parseFloat(val)
                              )
                            }}
                            onBlur={field.handleBlur}
                            className="w-28"
                          />
                          <span className="text-sm text-muted-foreground">
                            {currency}
                          </span>
                        </div>
                        <p className="text-muted-foreground text-sm">
                          {t('freeDeliveryThresholdDescription')}
                        </p>
                        {field.state.meta.errors.length > 0 && <p className="text-destructive text-sm">{String(field.state.meta.errors[0])}</p>}
                      </div>
                    )}
                  </form.Field>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Price Simulator - Only show when pricing is relevant */}
      {isEnabled && showPricing && (
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between">
              <div className="space-y-1">
                <CardTitle className="flex items-center gap-2">
                  <Calculator className="h-5 w-5" />
                  {t('simulator.title')}
                </CardTitle>
                <CardDescription>{t('simulator.description')}</CardDescription>
              </div>
              {hasCoordinates && (
                <Dialog open={isAddressDialogOpen} onOpenChange={setIsAddressDialogOpen}>
                  <DialogTrigger render={<Button variant="outline" className="shrink-0" />}>
                      <Search className="h-4 w-4 mr-2" />
                      {t('simulator.testAddress')}
                  </DialogTrigger>
                  <DialogPopup className="sm:max-w-md">
                    <DialogHeader>
                      <DialogTitle>{t('simulator.testAddressTitle')}</DialogTitle>
                      <DialogDescription>
                        {t('simulator.testAddressDescription')}
                      </DialogDescription>
                    </DialogHeader>
                    <DialogPanel>
                      <AddressInput
                        value={testAddress}
                        onChange={handleTestAddressChange}
                        placeholder={t('simulator.testAddressPlaceholder')}
                      />
                    </DialogPanel>
                  </DialogPopup>
                </Dialog>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Distance Slider */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>{t('simulator.distance')}</Label>
                <span className="text-sm font-medium tabular-nums">
                  {simDistance} km
                </span>
              </div>
              <Slider
                value={[simDistance]}
                onValueChange={(value) => setSimDistance(Array.isArray(value) ? value[0] : value)}
                min={1}
                max={maximumDistance || 100}
                step={1}
                className="w-full"
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>1 km</span>
                <span>{maximumDistance || 100} km</span>
              </div>
            </div>

            {/* Order Total Slider */}
            {freeDeliveryThreshold && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label>{t('simulator.orderTotal')}</Label>
                  <span className="text-sm font-medium tabular-nums">
                    {formatCurrency(simOrderTotal, currency)}
                  </span>
                </div>
                <Slider
                  value={[simOrderTotal]}
                  onValueChange={(value) => setSimOrderTotal(Array.isArray(value) ? value[0] : value)}
                  min={0}
                  max={Math.max(freeDeliveryThreshold * 1.5, 500)}
                  step={10}
                  className="w-full"
                />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>{formatCurrency(0, currency)}</span>
                  <span className="text-primary font-medium">
                    {t('simulator.freeAbove', { amount: formatCurrency(freeDeliveryThreshold, currency) })}
                  </span>
                </div>
              </div>
            )}

            {/* Result */}
            <div className="rounded-lg border-2 border-dashed p-4">
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <p className="text-sm text-muted-foreground">
                    {t('simulator.result')}
                  </p>
                  {simResult.reason === 'tooFar' && maximumDistance && (
                    <p className="text-xs text-destructive">
                      {t('simulator.tooFar', { max: maximumDistance })}
                    </p>
                  )}
                  {simResult.reason === 'threshold' && (
                    <p className="text-xs text-green-600 dark:text-green-400">
                      {t('simulator.freeDeliveryApplied')}
                    </p>
                  )}
                  {simResult.reason === 'calculated' && simResult.fee === minimumFee && (
                    <p className="text-xs text-muted-foreground">
                      {t('simulator.minimumApplied')}
                    </p>
                  )}
                </div>
                <div className="text-right">
                  {simResult.reason === 'tooFar' ? (
                    <span className="text-lg font-semibold text-destructive">
                      {t('simulator.notAvailable')}
                    </span>
                  ) : simResult.isFree ? (
                    <span className="text-lg font-semibold text-green-600 dark:text-green-400">
                      {t('simulator.free')}
                    </span>
                  ) : (
                    <span className="text-2xl font-bold text-primary">
                      {formatCurrency(simResult.fee, currency)}
                    </span>
                  )}
                </div>
              </div>

              {/* Calculation breakdown */}
              {simResult.reason === 'calculated' && (
                <div className="mt-3 pt-3 border-t text-xs text-muted-foreground space-y-1">
                  <div className="flex justify-between">
                    <span>{t('simulator.distanceLabel')}</span>
                    <span>{simDistance} km {roundTrip ? `× 2 = ${simDistance * 2} km` : ''}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>{t('simulator.rateLabel')}</span>
                    <span>{roundTrip ? simDistance * 2 : simDistance} km × {formatCurrency(pricePerKm, currency)}/km</span>
                  </div>
                  {simResult.fee === minimumFee && (
                    <div className="flex justify-between text-primary">
                      <span>{t('simulator.minimumLabel')}</span>
                      <span>{formatCurrency(minimumFee, currency)}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <FloatingSaveBar
        isDirty={isDirty}
        isLoading={isPending}
        onReset={() => form.reset()}
      />
      </form.Form>
    </form.AppForm>
  )
}
