'use client'

import { useEffect, useRef, useState } from 'react'
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
  DialogFooter,
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
import {
  setStoreLocationActive,
  updateDeliverySettings,
  upsertStoreLocation,
} from './actions'
import { FloatingSaveBar } from '@/components/dashboard/floating-save-bar'
import { formatCurrency } from '@louez/utils'
import type { StoreSettings, DeliverySettings } from '@louez/types'
import { useAppForm } from '@/hooks/form/form'
import { getFieldError } from '@/hooks/form/form-context'
import { RootError } from '@/components/form/root-error'

const DELIVERY_MODES = ['optional', 'required', 'included'] as const

const createDeliverySettingsSchema = (
  t: (key: string, params?: Record<string, string | number | Date>) => string
) =>
  z.object({
    enabled: z.boolean(),
    multiLocationEnabled: z.boolean(),
    mode: z.enum(DELIVERY_MODES),
    pricePerKm: z
      .number()
      .min(0, t('minValue', { min: 0 }))
      .max(100, t('maxValue', { max: 100 })),
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
    minimumOrderAmountForDelivery: z
      .number()
      .min(0, t('minValue', { min: 0 }))
      .max(100000, t('maxValue', { max: 100000 }))
      .nullable(),
  })

interface Store {
  id: string
  name: string
  address: string | null
  settings: StoreSettings | null
  latitude: string | null
  longitude: string | null
}

interface StoreLocation {
  id: string
  name: string
  address: string
  city: string | null
  postalCode: string | null
  country: string | null
  latitude: string | null
  longitude: string | null
  isActive: boolean
}

interface DeliverySettingsFormProps {
  store: Store
  hasCoordinates: boolean
  locations: StoreLocation[]
}

export function DeliverySettingsForm({
  store,
  hasCoordinates,
  locations,
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
    minimumFee: 10,
    maximumDistance: null,
    freeDeliveryThreshold: null,
    minimumOrderAmountForDelivery: null,
  }

  const [rootError, setRootError] = useState<string | null>(null)
  const form = useAppForm({
    defaultValues: {
      enabled: currentDelivery.enabled,
      multiLocationEnabled: currentDelivery.multiLocationEnabled ?? false,
      mode: currentDelivery.mode || 'optional',
      pricePerKm: currentDelivery.pricePerKm,
      minimumFee: currentDelivery.minimumFee,
      maximumDistance: currentDelivery.maximumDistance,
      freeDeliveryThreshold: currentDelivery.freeDeliveryThreshold,
      minimumOrderAmountForDelivery: currentDelivery.minimumOrderAmountForDelivery ?? null,
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
        form.options.defaultValues = value
        form.reset()
        router.refresh()
      })
    },
  })

  const isDirty = useStore(form.store, (s) => s.isDirty)

  const isEnabled = useStore(form.store, (s) => s.values.enabled)
  const multiLocationEnabled = useStore(form.store, (s) => s.values.multiLocationEnabled)
  const mode = useStore(form.store, (s) => s.values.mode)
  const pricePerKm = useStore(form.store, (s) => s.values.pricePerKm)
  const minimumFee = useStore(form.store, (s) => s.values.minimumFee)
  const maximumDistance = useStore(form.store, (s) => s.values.maximumDistance)
  const freeDeliveryThreshold = useStore(form.store, (s) => s.values.freeDeliveryThreshold)
  const minimumOrderAmountForDelivery = useStore(form.store, (s) => s.values.minimumOrderAmountForDelivery)

  // Pricing is only relevant when mode is not 'included'
  const showPricing = mode !== 'included'

  // Simulator state
  const [simDistance, setSimDistance] = useState(10)
  const [simOrderTotal, setSimOrderTotal] = useState(100)
  const [isAddressDialogOpen, setIsAddressDialogOpen] = useState(false)
  const [testAddress, setTestAddress] = useState('')
  const [testLatitude, setTestLatitude] = useState<number | null>(null)
  const [testLongitude, setTestLongitude] = useState<number | null>(null)
  const [testDistance, setTestDistance] = useState<number | null>(null)
  const [locationFormOpen, setLocationFormOpen] = useState(false)
  const [editingLocation, setEditingLocation] = useState<StoreLocation | null>(null)
  const [locationName, setLocationName] = useState('')
  const [locationAddress, setLocationAddress] = useState('')
  const [locationLatitude, setLocationLatitude] = useState<number | null>(null)
  const [locationLongitude, setLocationLongitude] = useState<number | null>(null)

  const testMapRef = useRef<HTMLDivElement>(null)
  const testMapInstanceRef = useRef<unknown>(null)
  const testStoreMarkerRef = useRef<unknown>(null)
  const testAddressMarkerRef = useRef<unknown>(null)

  // Store coordinates for distance calculation
  const storeLatitude = store.latitude ? parseFloat(store.latitude) : null
  const storeLongitude = store.longitude ? parseFloat(store.longitude) : null

  // Calculate example delivery cost (per leg)
  const getExampleCost = (distance: number) => {
    const cost = distance * pricePerKm
    return Math.max(cost, minimumFee)
  }

  // Calculate simulated delivery fee (per leg)
  const getSimulatedFee = () => {
    if (
      mode === 'optional' &&
      minimumOrderAmountForDelivery &&
      simOrderTotal < minimumOrderAmountForDelivery
    ) {
      return { fee: 0, isFree: false, reason: 'minimumOrder' as const }
    }

    // Check if free delivery applies
    if (freeDeliveryThreshold && simOrderTotal >= freeDeliveryThreshold) {
      return { fee: 0, isFree: true, reason: 'threshold' as const }
    }

    // Check if distance exceeds maximum
    if (maximumDistance && simDistance > maximumDistance) {
      return { fee: 0, isFree: false, reason: 'tooFar' as const }
    }

    // Calculate per-leg fee
    const calculatedFee = simDistance * pricePerKm
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
    setTestLatitude(latitude)
    setTestLongitude(longitude)

    if (latitude && longitude && storeLatitude && storeLongitude) {
      const distance = calculateHaversineDistance(
        storeLatitude,
        storeLongitude,
        latitude,
        longitude
      )
      setTestDistance(Math.round(distance * 10) / 10)
    } else {
      setTestDistance(null)
    }
  }

  const handleApplyTestDistance = () => {
    if (testDistance !== null) {
      setSimDistance(testDistance)
    }
    setIsAddressDialogOpen(false)
  }

  const openLocationForm = (location?: StoreLocation) => {
    setEditingLocation(location ?? null)
    setLocationName(location?.name ?? '')
    setLocationAddress(location?.address ?? '')
    setLocationLatitude(location?.latitude ? parseFloat(location.latitude) : null)
    setLocationLongitude(location?.longitude ? parseFloat(location.longitude) : null)
    setLocationFormOpen(true)
  }

  const handleLocationAddressChange = (
    address: string,
    latitude: number | null,
    longitude: number | null,
  ) => {
    setLocationAddress(address)
    setLocationLatitude(latitude)
    setLocationLongitude(longitude)
  }

  const handleSaveLocation = () => {
    startTransition(async () => {
      const result = await upsertStoreLocation({
        id: editingLocation?.id,
        name: locationName,
        address: locationAddress,
        latitude: locationLatitude,
        longitude: locationLongitude,
        country: store.settings?.country ?? 'FR',
      })
      if (result.error) {
        toastManager.add({ title: t('locationsSaveError'), type: 'error' })
        return
      }
      toastManager.add({ title: t('locationsSaved'), type: 'success' })
      setLocationFormOpen(false)
      router.refresh()
    })
  }

  const handleToggleLocationActive = (location: StoreLocation) => {
    startTransition(async () => {
      const result = await setStoreLocationActive(location.id, !location.isActive)
      if (result.error) {
        toastManager.add({ title: t('locationsSaveError'), type: 'error' })
        return
      }
      router.refresh()
    })
  }

  // Initialize test map when dialog opens
  useEffect(() => {
    if (!isAddressDialogOpen) return

    // Load Leaflet CSS
    if (!document.getElementById('leaflet-css')) {
      const link = document.createElement('link')
      link.id = 'leaflet-css'
      link.rel = 'stylesheet'
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'
      link.integrity = 'sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY='
      link.crossOrigin = ''
      document.head.appendChild(link)
    }

    const loadAndInit = async () => {
      if (typeof window !== 'undefined' && !window.L) {
        await new Promise<void>((resolve) => {
          const script = document.createElement('script')
          script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'
          script.integrity = 'sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo='
          script.crossOrigin = ''
          script.onload = () => resolve()
          document.head.appendChild(script)
        })
      }
      setTimeout(initMap, 100)
    }

    const initMap = () => {
      if (!testMapRef.current || !window.L) return

      if (testMapInstanceRef.current) {
        (testMapInstanceRef.current as { remove: () => void }).remove()
        testMapInstanceRef.current = null
        testStoreMarkerRef.current = null
        testAddressMarkerRef.current = null
      }

      const L = window.L as typeof import('leaflet')
      const lat = storeLatitude ?? 48.8566
      const lng = storeLongitude ?? 2.3522

      const map = L.map(testMapRef.current, {
        zoomControl: true,
        scrollWheelZoom: false,
      }).setView([lat, lng], 12)

      L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
        subdomains: 'abcd',
        maxZoom: 20,
      }).addTo(map)

      // Store marker (green)
      if (storeLatitude && storeLongitude) {
        const storeIcon = L.divIcon({
          className: 'store-marker',
          html: `<div style="
            background-color: #16a34a;
            width: 32px;
            height: 32px;
            border-radius: 50% 50% 50% 0;
            transform: rotate(-45deg);
            display: flex;
            align-items: center;
            justify-content: center;
            box-shadow: 0 3px 12px rgba(0,0,0,0.3);
            border: 2px solid white;
          ">
            <svg style="transform: rotate(45deg); width: 14px; height: 14px;" viewBox="0 0 24 24" fill="white" stroke="white" stroke-width="1">
              <circle cx="12" cy="10" r="3"/>
            </svg>
          </div>`,
          iconSize: [32, 32],
          iconAnchor: [16, 32],
        })

        L.marker([storeLatitude, storeLongitude], { icon: storeIcon }).addTo(map)
        testStoreMarkerRef.current = true
      }

      testMapInstanceRef.current = map
    }

    loadAndInit()

    return () => {
      if (testMapInstanceRef.current) {
        (testMapInstanceRef.current as { remove: () => void }).remove()
        testMapInstanceRef.current = null
        testStoreMarkerRef.current = null
        testAddressMarkerRef.current = null
      }
    }
  }, [isAddressDialogOpen, storeLatitude, storeLongitude])

  // Update test address marker when coordinates change
  useEffect(() => {
    if (!testMapInstanceRef.current || !window.L || testLatitude === null || testLongitude === null) return

    const L = window.L as typeof import('leaflet')
    const map = testMapInstanceRef.current as import('leaflet').Map

    if (testAddressMarkerRef.current) {
      (testAddressMarkerRef.current as { setLatLng: (latlng: [number, number]) => void }).setLatLng([testLatitude, testLongitude])
    } else {
      const addressIcon = L.divIcon({
        className: 'test-address-marker',
        html: `<div style="
          background-color: #2563eb;
          width: 32px;
          height: 32px;
          border-radius: 50% 50% 50% 0;
          transform: rotate(-45deg);
          display: flex;
          align-items: center;
          justify-content: center;
          box-shadow: 0 3px 12px rgba(0,0,0,0.3);
          border: 2px solid white;
        ">
          <svg style="transform: rotate(45deg); width: 14px; height: 14px;" viewBox="0 0 24 24" fill="white" stroke="white" stroke-width="1">
            <circle cx="12" cy="10" r="3"/>
          </svg>
        </div>`,
        iconSize: [32, 32],
        iconAnchor: [16, 32],
      })

      const marker = L.marker([testLatitude, testLongitude], { icon: addressIcon }).addTo(map)
      testAddressMarkerRef.current = marker
    }

    // Fit bounds to show both markers
    if (storeLatitude && storeLongitude) {
      const bounds = L.latLngBounds(
        [storeLatitude, storeLongitude],
        [testLatitude, testLongitude]
      )
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 })
    } else {
      map.setView([testLatitude, testLongitude], 14)
    }
  }, [testLatitude, testLongitude, storeLatitude, storeLongitude])

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

          <form.AppField name="multiLocationEnabled">
            {(field) => (
              <field.Switch
                label={t('multiLocationEnabled')}
                description={t('multiLocationEnabledDescription')}
              />
            )}
          </form.AppField>

          {multiLocationEnabled && (
            <div className="space-y-4 rounded-lg border p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-medium">{t('locationsTitle')}</h3>
                  <p className="text-muted-foreground text-sm">
                    {t('locationsDescription')}
                  </p>
                </div>
                <Button type="button" variant="outline" onClick={() => openLocationForm()}>
                  <MapPin className="mr-2 h-4 w-4" />
                  {t('locationsAdd')}
                </Button>
              </div>

              <div className="space-y-2">
                <div className="rounded-md border bg-muted/30 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium">{store.name}</p>
                      {store.address && (
                        <p className="text-muted-foreground text-xs">{store.address}</p>
                      )}
                    </div>
                    <span className="text-muted-foreground text-xs">
                      {t('locationsPrimary')}
                    </span>
                  </div>
                </div>

                {locations.map((location) => (
                  <div key={location.id} className="rounded-md border p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium">{location.name}</p>
                          {!location.isActive && (
                            <span className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                              {t('locationsInactive')}
                            </span>
                          )}
                        </div>
                        <p className="text-muted-foreground text-xs">{location.address}</p>
                      </div>
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => openLocationForm(location)}
                        >
                          {t('locationsEdit')}
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => handleToggleLocationActive(location)}
                        >
                          {location.isActive ? t('locationsDeactivate') : t('locationsReactivate')}
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <Dialog open={locationFormOpen} onOpenChange={setLocationFormOpen}>
                <DialogPopup>
                  <DialogPanel>
                    <DialogHeader>
                      <DialogTitle>
                        {editingLocation ? t('locationsEdit') : t('locationsAdd')}
                      </DialogTitle>
                      <DialogDescription>{t('locationsDialogDescription')}</DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                      <div className="grid gap-2">
                        <Label htmlFor="location-name">{t('locationsName')}</Label>
                        <Input
                          id="location-name"
                          value={locationName}
                          onChange={(event) => setLocationName(event.target.value)}
                        />
                      </div>
                      <div className="grid gap-2">
                        <Label>{t('locationsAddress')}</Label>
                        <AddressInput
                          value={locationAddress}
                          latitude={locationLatitude}
                          longitude={locationLongitude}
                          onChange={handleLocationAddressChange}
                        />
                      </div>
                    </div>
                    <DialogFooter>
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setLocationFormOpen(false)}
                      >
                        {tCommon('cancel')}
                      </Button>
                      <Button
                        type="button"
                        onClick={handleSaveLocation}
                        disabled={!locationName.trim() || !locationAddress.trim() || isPending}
                      >
                        {tCommon('save')}
                      </Button>
                    </DialogFooter>
                  </DialogPanel>
                </DialogPopup>
              </Dialog>
            </div>
          )}

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
                  {field.state.meta.errors.length > 0 && <p className="text-destructive text-sm">{getFieldError(field.state.meta.errors[0])}</p>}
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
                        {field.state.meta.errors.length > 0 && <p className="text-destructive text-sm">{getFieldError(field.state.meta.errors[0])}</p>}
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
                        {field.state.meta.errors.length > 0 && <p className="text-destructive text-sm">{getFieldError(field.state.meta.errors[0])}</p>}
                      </div>
                    )}
                  </form.Field>
                </div>
              </div>

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
                        {field.state.meta.errors.length > 0 && <p className="text-destructive text-sm">{getFieldError(field.state.meta.errors[0])}</p>}
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
                        {field.state.meta.errors.length > 0 && <p className="text-destructive text-sm">{getFieldError(field.state.meta.errors[0])}</p>}
                      </div>
                    )}
                  </form.Field>

                  {/* Minimum order amount for delivery */}
                  <form.Field name="minimumOrderAmountForDelivery">
                    {(field) => (
                      <div className="grid gap-2">
                        <Label htmlFor={field.name} className="flex items-center gap-2">
                          {t('minimumOrderAmountForDelivery')}
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
                          {t('minimumOrderAmountForDeliveryDescription')}
                        </p>
                        {field.state.meta.errors.length > 0 && <p className="text-destructive text-sm">{getFieldError(field.state.meta.errors[0])}</p>}
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
                <Dialog
                  open={isAddressDialogOpen}
                  onOpenChange={(open) => {
                    setIsAddressDialogOpen(open)
                    if (open) {
                      setTestAddress('')
                      setTestLatitude(null)
                      setTestLongitude(null)
                      setTestDistance(null)
                    }
                  }}
                >
                  <DialogTrigger render={<Button variant="outline" className="shrink-0" />}>
                      <Search className="h-4 w-4 mr-2" />
                      {t('simulator.testAddress')}
                  </DialogTrigger>
                  <DialogPopup className="sm:max-w-lg">
                    <DialogHeader>
                      <DialogTitle>{t('simulator.testAddressTitle')}</DialogTitle>
                      <DialogDescription>
                        {t('simulator.testAddressDescription')}
                      </DialogDescription>
                    </DialogHeader>
                    <DialogPanel>
                      <div className="space-y-4">
                        <AddressInput
                          value={testAddress}
                          onChange={handleTestAddressChange}
                          placeholder={t('simulator.testAddressPlaceholder')}
                        />

                        {/* Map preview */}
                        <div
                          ref={testMapRef}
                          className="h-[200px] rounded-lg border bg-muted"
                          style={{ zIndex: 0 }}
                        />

                        {/* Distance result */}
                        {testDistance !== null && (
                          <div className="flex items-center justify-between rounded-lg border bg-muted/50 p-3">
                            <div className="flex items-center gap-2 text-sm">
                              <MapPin className="h-4 w-4 text-muted-foreground" />
                              <span>{t('simulator.calculatedDistance')}</span>
                            </div>
                            <span className="text-lg font-semibold">{testDistance} km</span>
                          </div>
                        )}
                      </div>
                    </DialogPanel>
                    <DialogFooter className="border-t pt-4">
                      <Button variant="outline" onClick={() => setIsAddressDialogOpen(false)}>
                        {tCommon('cancel')}
                      </Button>
                      <Button
                        onClick={handleApplyTestDistance}
                        disabled={testDistance === null}
                      >
                        {t('simulator.applyDistance')}
                      </Button>
                    </DialogFooter>
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
            {(freeDeliveryThreshold || minimumOrderAmountForDelivery) && (
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
                  max={Math.max(
                    (freeDeliveryThreshold ?? 0) * 1.5,
                    (minimumOrderAmountForDelivery ?? 0) * 1.5,
                    500,
                  )}
                  step={10}
                  className="w-full"
                />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>{formatCurrency(0, currency)}</span>
                  <div className="flex flex-col items-end gap-1">
                    {minimumOrderAmountForDelivery && mode === 'optional' && (
                      <span className="text-primary font-medium">
                        {t('simulator.availableAbove', { amount: formatCurrency(minimumOrderAmountForDelivery, currency) })}
                      </span>
                    )}
                    {freeDeliveryThreshold && (
                      <span className="text-green-600 font-medium">
                        {t('simulator.freeAbove', { amount: formatCurrency(freeDeliveryThreshold, currency) })}
                      </span>
                    )}
                  </div>
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
                  {simResult.reason === 'minimumOrder' && minimumOrderAmountForDelivery && (
                    <p className="text-xs text-destructive">
                      {t('simulator.minimumOrderNotMet', {
                        amount: formatCurrency(minimumOrderAmountForDelivery, currency),
                      })}
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
                  {simResult.reason === 'tooFar' || simResult.reason === 'minimumOrder' ? (
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
                    <span>{simDistance} km</span>
                  </div>
                  <div className="flex justify-between">
                    <span>{t('simulator.rateLabel')}</span>
                    <span>{simDistance} km × {formatCurrency(pricePerKm, currency)}/km</span>
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
