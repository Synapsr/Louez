'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { z } from 'zod'
import { Loader2, Info, Truck, AlertTriangle, MapPin, Calculator, Search, Package, Gift } from 'lucide-react'
import Link from 'next/link'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { AddressInput } from '@/components/ui/address-input'
import { calculateHaversineDistance } from '@/lib/utils/geo'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { updateDeliverySettings } from './actions'
import { formatCurrency } from '@/lib/utils'
import type { StoreSettings, DeliverySettings, DeliveryMode } from '@/types'

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

  const form = useForm<DeliverySettingsInput>({
    resolver: zodResolver(deliverySettingsSchema),
    defaultValues: {
      enabled: currentDelivery.enabled,
      mode: currentDelivery.mode || 'optional',
      pricePerKm: currentDelivery.pricePerKm,
      roundTrip: currentDelivery.roundTrip,
      minimumFee: currentDelivery.minimumFee,
      maximumDistance: currentDelivery.maximumDistance,
      freeDeliveryThreshold: currentDelivery.freeDeliveryThreshold,
    },
  })

  const isEnabled = form.watch('enabled')
  const mode = form.watch('mode')
  const pricePerKm = form.watch('pricePerKm')
  const roundTrip = form.watch('roundTrip')
  const minimumFee = form.watch('minimumFee')
  const maximumDistance = form.watch('maximumDistance')
  const freeDeliveryThreshold = form.watch('freeDeliveryThreshold')

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

  const onSubmit = (data: DeliverySettingsInput) => {
    startTransition(async () => {
      const result = await updateDeliverySettings(data)
      if (result.error) {
        if (result.error === 'errors.storeCoordinatesRequired') {
          toast.error(t('noCoordinatesError'))
        } else {
          form.setError('root', { message: result.error })
        }
        return
      }
      toast.success(t('saved'))
      router.refresh()
    })
  }

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
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        {form.formState.errors.root && (
          <div className="rounded-lg bg-destructive/10 p-4 text-sm text-destructive">
            {form.formState.errors.root.message}
          </div>
        )}

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
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription className="flex items-center justify-between">
                  <span>{t('noCoordinatesWarning')}</span>
                  <Button variant="outline" size="sm" asChild>
                    <Link href="/dashboard/settings">
                      <MapPin className="mr-2 h-4 w-4" />
                      {t('goToStoreSettings')}
                    </Link>
                  </Button>
                </AlertDescription>
              </Alert>
            )}

            {/* Enable Switch */}
            <FormField
              control={form.control}
              name="enabled"
              render={({ field }) => (
                <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                  <div className="space-y-0.5">
                    <FormLabel className="text-base">{t('enabled')}</FormLabel>
                    <FormDescription>{t('enabledDescription')}</FormDescription>
                  </div>
                  <FormControl>
                    <Switch
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      disabled={!hasCoordinates}
                    />
                  </FormControl>
                </FormItem>
              )}
            />

            {/* Delivery Mode Selection */}
            {isEnabled && (
              <FormField
                control={form.control}
                name="mode"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('modeSection')}</FormLabel>
                    <FormControl>
                      <RadioGroup
                        onValueChange={field.onChange}
                        value={field.value}
                        className="grid gap-3 sm:grid-cols-3"
                      >
                        {/* Optional - Customer chooses */}
                        <label
                          htmlFor="mode-optional"
                          className={`relative flex flex-col gap-2 rounded-lg border p-4 cursor-pointer transition-colors ${
                            field.value === 'optional'
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
                            field.value === 'required'
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
                            field.value === 'included'
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
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
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
                    <FormField
                      control={form.control}
                      name="pricePerKm"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t('pricePerKm')}</FormLabel>
                          <FormControl>
                            <div className="flex items-center gap-2">
                              <Input
                                type="number"
                                min={0}
                                max={100}
                                step={0.1}
                                {...field}
                                onChange={(e) =>
                                  field.onChange(parseFloat(e.target.value) || 0)
                                }
                                className="w-24"
                              />
                              <span className="text-sm text-muted-foreground">
                                {currency}/km
                              </span>
                            </div>
                          </FormControl>
                          <FormDescription>
                            {t('pricePerKmDescription')}
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    {/* Minimum fee */}
                    <FormField
                      control={form.control}
                      name="minimumFee"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t('minimumFee')}</FormLabel>
                          <FormControl>
                            <div className="flex items-center gap-2">
                              <Input
                                type="number"
                                min={0}
                                max={1000}
                                step={0.5}
                                {...field}
                                onChange={(e) =>
                                  field.onChange(parseFloat(e.target.value) || 0)
                                }
                                className="w-24"
                              />
                              <span className="text-sm text-muted-foreground">
                                {currency}
                              </span>
                            </div>
                          </FormControl>
                          <FormDescription>
                            {t('minimumFeeDescription')}
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </div>
                </div>

                {/* Round Trip Option */}
                <FormField
                  control={form.control}
                  name="roundTrip"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('tripType')}</FormLabel>
                      <FormControl>
                        <RadioGroup
                          onValueChange={(value) =>
                            field.onChange(value === 'true')
                          }
                          value={String(field.value)}
                          className="grid gap-2 sm:grid-cols-2"
                        >
                          <label
                            htmlFor="oneWay"
                            className={`flex items-center gap-3 rounded-lg border p-3 cursor-pointer transition-colors ${
                              !field.value
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
                              field.value
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
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

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
                    <FormField
                      control={form.control}
                      name="maximumDistance"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="flex items-center gap-2">
                            {t('maximumDistance')}
                            <span className="text-xs text-muted-foreground font-normal">
                              ({tCommon('optional')})
                            </span>
                          </FormLabel>
                          <FormControl>
                            <div className="flex items-center gap-2">
                              <Input
                                type="number"
                                min={1}
                                max={500}
                                placeholder="-"
                                value={field.value ?? ''}
                                onChange={(e) => {
                                  const val = e.target.value
                                  field.onChange(
                                    val === '' ? null : parseFloat(val)
                                  )
                                }}
                                className="w-24"
                              />
                              <span className="text-sm text-muted-foreground">
                                km
                              </span>
                            </div>
                          </FormControl>
                          <FormDescription>
                            {t('maximumDistanceDescription')}
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    {/* Free delivery threshold */}
                    <FormField
                      control={form.control}
                      name="freeDeliveryThreshold"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel className="flex items-center gap-2">
                            {t('freeDeliveryThreshold')}
                            <span className="text-xs text-muted-foreground font-normal">
                              ({tCommon('optional')})
                            </span>
                          </FormLabel>
                          <FormControl>
                            <div className="flex items-center gap-2">
                              <Input
                                type="number"
                                min={0}
                                max={100000}
                                placeholder="-"
                                value={field.value ?? ''}
                                onChange={(e) => {
                                  const val = e.target.value
                                  field.onChange(
                                    val === '' ? null : parseFloat(val)
                                  )
                                }}
                                className="w-28"
                              />
                              <span className="text-sm text-muted-foreground">
                                {currency}
                              </span>
                            </div>
                          </FormControl>
                          <FormDescription>
                            {t('freeDeliveryThresholdDescription')}
                          </FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
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
                    <DialogTrigger asChild>
                      <Button variant="outline" size="sm" className="shrink-0">
                        <Search className="h-4 w-4 mr-2" />
                        {t('simulator.testAddress')}
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="sm:max-w-md">
                      <DialogHeader>
                        <DialogTitle>{t('simulator.testAddressTitle')}</DialogTitle>
                        <DialogDescription>
                          {t('simulator.testAddressDescription')}
                        </DialogDescription>
                      </DialogHeader>
                      <div className="py-4">
                        <AddressInput
                          value={testAddress}
                          onChange={handleTestAddressChange}
                          placeholder={t('simulator.testAddressPlaceholder')}
                        />
                      </div>
                    </DialogContent>
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
                  onValueChange={([value]) => setSimDistance(value)}
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
                    onValueChange={([value]) => setSimOrderTotal(value)}
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

        <div className="flex justify-end">
          <Button type="submit" disabled={isPending}>
            {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {tCommon('save')}
          </Button>
        </div>
      </form>
    </Form>
  )
}
