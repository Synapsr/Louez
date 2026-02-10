'use client'

import { useState, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { useStore } from '@tanstack/react-form'
import {
  Loader2,
  Upload,
  X,
  ImageIcon,
  Star,
  Plus,
  ArrowLeft,
  ArrowRight,
  Check,
  Eye,
  Package,
  Video,
} from 'lucide-react'
import { toastManager } from '@louez/ui'
import { useTranslations } from 'next-intl'

import { Button } from '@louez/ui'
import { Input } from '@louez/ui'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@louez/ui'
import { Label } from '@louez/ui'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@louez/ui'
import { RadioGroup, RadioGroupItem } from '@louez/ui'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@louez/ui'
import { Stepper, StepContent, StepActions } from '@louez/ui'
import { RichTextEditor } from '@/components/ui/rich-text-editor'
import { FloatingSaveBar } from '@/components/dashboard/floating-save-bar'
import { Badge } from '@louez/ui'
import { Separator } from '@louez/ui'
import { cn, formatCurrency, getCurrencySymbol } from '@louez/utils'
import { PricingTiersEditor } from '@/components/dashboard/pricing-tiers-editor'
import type { PricingMode } from '@louez/types'

import { productSchema, type ProductInput, type PricingTierInput, type ProductUnitInput } from '@louez/validations'
import { createProduct, updateProduct, createCategory } from './actions'
import type { TaxSettings, ProductTaxSettings } from '@louez/types'
import { Switch } from '@louez/ui'
import { AccessoriesSelector } from '@/components/dashboard/accessories-selector'
import { UnitTrackingEditor } from '@/components/dashboard/unit-tracking-editor'
import { Link2, Puzzle } from 'lucide-react'
import { useAppForm } from '@/hooks/form/form'

interface Category {
  id: string
  name: string
}

interface PricingTierData {
  id: string
  minDuration: number
  discountPercent: string
  displayOrder: number | null
}

interface ProductUnitData {
  id: string
  identifier: string
  notes: string | null
  status: 'available' | 'maintenance' | 'retired'
}

interface Product {
  id: string
  name: string
  description: string | null
  categoryId: string | null
  price: string
  deposit: string | null
  pricingMode: PricingMode | null
  pricingTiers?: PricingTierData[]
  quantity: number
  status: 'draft' | 'active' | 'archived' | null
  images: string[] | null
  videoUrl: string | null
  taxSettings?: ProductTaxSettings | null
  enforceStrictTiers?: boolean
  accessoryIds?: string[]
  trackUnits?: boolean
  units?: ProductUnitData[]
}

interface AvailableAccessory {
  id: string
  name: string
  price: string
  images: string[] | null
}

interface ProductFormProps {
  product?: Product
  categories: Category[]
  pricingMode: 'day' | 'hour' | 'week'
  currency?: string
  storeTaxSettings?: TaxSettings
  availableAccessories?: AvailableAccessory[]
}

export function ProductForm({ product, categories, pricingMode, currency = 'EUR', storeTaxSettings, availableAccessories = [] }: ProductFormProps) {
  const router = useRouter()
  const t = useTranslations('dashboard.products.form')
  const tCommon = useTranslations('common')
  const tErrors = useTranslations('errors')
  const currencySymbol = getCurrencySymbol(currency)

  const STEPS = useMemo(() => [
    { id: 'photos', title: t('steps.photos'), description: t('steps.photosDescription') },
    { id: 'info', title: t('steps.info'), description: t('steps.infoDescription') },
    { id: 'pricing', title: t('steps.pricing'), description: t('steps.pricingDescription') },
    { id: 'preview', title: t('steps.preview'), description: t('steps.previewDescription') },
  ], [t])

  const isEditMode = !!product
  const [currentStep, setCurrentStep] = useState(0)
  const [isLoading, setIsLoading] = useState(false)
  const [imagesPreviews, setImagesPreviews] = useState<string[]>(product?.images ?? [])
  const [isDragging, setIsDragging] = useState(false)
  const [newCategoryName, setNewCategoryName] = useState('')
  const [categoryDialogOpen, setCategoryDialogOpen] = useState(false)
  const [isCreatingCategory, setIsCreatingCategory] = useState(false)
  const [isUploadingImages, setIsUploadingImages] = useState(false)

  // Convert product pricing tiers to input format
  const initialPricingTiers: PricingTierInput[] = product?.pricingTiers?.map((tier) => ({
    id: tier.id,
    minDuration: tier.minDuration,
    discountPercent: parseFloat(tier.discountPercent),
  })) ?? []

  // Convert product units to input format
  const initialUnits: ProductUnitInput[] = product?.units?.map((unit) => ({
    id: unit.id,
    identifier: unit.identifier,
    notes: unit.notes || '',
    status: unit.status,
  })) ?? []

  const form = useAppForm({
    defaultValues: {
      name: product?.name || '',
      description: product?.description || '',
      categoryId: product?.categoryId || null as string | null,
      price: product?.price || '',
      deposit: product?.deposit || '',
      quantity: product?.quantity?.toString() || '1',
      status: (product?.status || 'draft') as 'draft' | 'active' | 'archived',
      images: product?.images ?? [] as string[],
      pricingMode: (product?.pricingMode || null) as PricingMode | null,
      pricingTiers: initialPricingTiers,
      enforceStrictTiers: product?.enforceStrictTiers || false,
      taxSettings: product?.taxSettings || { inheritFromStore: true } as ProductTaxSettings,
      videoUrl: product?.videoUrl || '',
      accessoryIds: product?.accessoryIds || [] as string[],
      trackUnits: product?.trackUnits || false,
      units: initialUnits,
    },
    validators: { onSubmit: productSchema as any },
    onSubmit: async ({ value }) => {
      setIsLoading(true)
      try {
        const result = product
          ? await updateProduct(product.id, value as ProductInput)
          : await createProduct(value as ProductInput)

        if (result.error) {
          toastManager.add({ title: result.error, type: 'error' })
          return
        }

        toastManager.add({ title: product ? t('productUpdated') : t('productCreated'), type: 'success' })
        router.push('/dashboard/products')
      } catch {
        toastManager.add({ title: tErrors('generic'), type: 'error' })
      } finally {
        setIsLoading(false)
      }
    },
  })

  const watchedValues = useStore(form.store, (s) => s.values)
  const isDirty = useStore(form.store, (s) => s.isDirty)

  const processFiles = useCallback(
    async (files: FileList | File[]) => {
      const fileArray = Array.from(files)
      const filesToProcess = Math.min(fileArray.length, 5 - imagesPreviews.length)

      if (filesToProcess === 0) return

      setIsUploadingImages(true)
      const uploadedUrls: string[] = []

      try {
        for (let i = 0; i < filesToProcess; i++) {
          const file = fileArray[i]

          if (!file.type.startsWith('image/')) {
            toastManager.add({ title: t('imageError'), type: 'error' })
            continue
          }

          if (file.size > 15 * 1024 * 1024) {
            toastManager.add({ title: t('imageSizeError'), type: 'error' })
            continue
          }

          // Convert file to base64 for API upload
          const base64 = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader()
            reader.onload = () => resolve(reader.result as string)
            reader.onerror = reject
            reader.readAsDataURL(file)
          })

          // Upload to S3 via API
          const response = await fetch('/api/upload/image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              image: base64,
              type: 'product',
              filename: `product-${Date.now()}`,
            }),
          })

          if (!response.ok) {
            const error = await response.json()
            throw new Error(error.error || 'Upload failed')
          }

          const { url } = await response.json()
          uploadedUrls.push(url)
        }

        if (uploadedUrls.length > 0) {
          const updatedPreviews = [...imagesPreviews, ...uploadedUrls]
          setImagesPreviews(updatedPreviews)
          form.setFieldValue('images', updatedPreviews)
        }
      } catch (error) {
        console.error('Image upload error:', error)
        toastManager.add({ title: t('imageUploadError'), type: 'error' })
      } finally {
        setIsUploadingImages(false)
      }
    },
    [form, imagesPreviews, t]
  )

  const handleImageUpload = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files
      if (!files) return
      processFiles(files)
    },
    [processFiles]
  )

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }, [])

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setIsDragging(false)

      const files = e.dataTransfer.files
      if (files && files.length > 0) {
        processFiles(files)
      }
    },
    [processFiles]
  )

  const removeImage = (index: number) => {
    const newPreviews = imagesPreviews.filter((_, i) => i !== index)
    setImagesPreviews(newPreviews)
    form.setFieldValue('images', newPreviews)
  }

  const setMainImage = (index: number) => {
    if (index === 0) return
    const newPreviews = [...imagesPreviews]
    const [moved] = newPreviews.splice(index, 1)
    newPreviews.unshift(moved)
    setImagesPreviews(newPreviews)
    form.setFieldValue('images', newPreviews)
  }

  const handleReset = useCallback(() => {
    form.reset()
    setImagesPreviews(product?.images ?? [])
  }, [form, product?.images])

  const handleCreateCategory = async () => {
    if (!newCategoryName.trim()) return

    setIsCreatingCategory(true)
    try {
      const result = await createCategory({ name: newCategoryName.trim() })
      if (result.error) {
        toastManager.add({ title: result.error, type: 'error' })
      } else {
        toastManager.add({ title: t('categoryCreated'), type: 'success' })
        setNewCategoryName('')
        setCategoryDialogOpen(false)
        router.refresh()
      }
    } catch {
      toastManager.add({ title: tErrors('generic'), type: 'error' })
    } finally {
      setIsCreatingCategory(false)
    }
  }

  const validateCurrentStep = async (): Promise<boolean> => {
    let fieldsToValidate: string[] = []

    switch (currentStep) {
      case 0: // Photos
        fieldsToValidate = ['images']
        break
      case 1: // Info
        fieldsToValidate = ['name', 'description']
        break
      case 2: // Pricing
        fieldsToValidate = ['price', 'deposit', 'quantity']
        break
      case 3: // Preview
        fieldsToValidate = ['status']
        break
    }

    const results = await Promise.all(
      fieldsToValidate.map((field) => form.validateField(field as any, 'submit'))
    )

    // Check if any field has errors
    const hasErrors = fieldsToValidate.some((field) => {
      const fieldState = form.getFieldMeta(field as any)
      return fieldState?.errors && fieldState.errors.length > 0
    })

    return !hasErrors
  }

  const goToNextStep = async () => {
    const isValid = await validateCurrentStep()
    if (isValid && currentStep < STEPS.length - 1) {
      setCurrentStep(currentStep + 1)
    }
  }

  const goToPreviousStep = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1)
    }
  }

  const selectedCategory = categories.find((c) => c.id === watchedValues.categoryId)

  // Effective pricing mode (product-specific or store default)
  const effectivePricingMode: PricingMode = watchedValues.pricingMode || pricingMode

  const priceLabel =
    effectivePricingMode === 'day'
      ? t('pricePerDay')
      : effectivePricingMode === 'hour'
        ? t('pricePerHour')
        : t('pricePerWeek')

  // Parse base price for the pricing tiers editor
  const basePrice = parseFloat(watchedValues.price?.replace(',', '.') || '0') || 0

  // Render image upload section (shared between modes)
  const renderImageUpload = () => (
    <form.Field name="images">
      {(field) => (
        <div>
          <div className="space-y-4">
              {/* Large upload zone when no images */}
              {imagesPreviews.length === 0 && (
                <label
                  className={`flex h-48 cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed transition-colors bg-muted/20 ${
                    isUploadingImages
                      ? 'border-primary bg-primary/10 cursor-wait'
                      : isDragging
                        ? 'border-primary bg-primary/10'
                        : 'border-muted-foreground/25 hover:border-primary/50'
                  }`}
                  onDragOver={handleDragOver}
                  onDragEnter={handleDragEnter}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                >
                  {isUploadingImages ? (
                    <>
                      <Loader2 className="h-10 w-10 mb-3 text-primary animate-spin" />
                      <span className="text-sm font-medium">{t('uploading')}</span>
                    </>
                  ) : (
                    <>
                      <Upload className={`h-10 w-10 mb-3 ${isDragging ? 'text-primary' : 'text-muted-foreground'}`} />
                      <span className="text-sm font-medium">{t('addImage')}</span>
                      <span className="text-xs text-muted-foreground mt-1">
                        {t('dragImages')}
                      </span>
                    </>
                  )}
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    className="sr-only"
                    onChange={handleImageUpload}
                    disabled={isUploadingImages}
                  />
                </label>
              )}

              {/* Image grid */}
              {imagesPreviews.length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                  {imagesPreviews.map((preview, index) => (
                    <div
                      key={index}
                      className="group relative aspect-square"
                    >
                      <img
                        src={preview}
                        alt={`Product image ${index + 1}`}
                        className="h-full w-full rounded-lg object-cover border"
                      />
                      <div className="absolute inset-0 flex items-center justify-center gap-1 rounded-lg bg-black/60 opacity-0 transition-opacity group-hover:opacity-100">
                        {index !== 0 && (
                          <Button
                            type="button"
                            variant="secondary"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => setMainImage(index)}
                            title={t('setAsMain')}
                          >
                            <Star className="h-4 w-4" />
                          </Button>
                        )}
                        <Button
                          type="button"
                          variant="destructive"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => removeImage(index)}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                      {index === 0 && (
                        <Badge className="absolute -top-2 -left-2" variant="default">
                          {t('mainBadge')}
                        </Badge>
                      )}
                    </div>
                  ))}

                  {imagesPreviews.length < 5 && (
                    <label
                      className={`flex aspect-square cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed transition-colors ${
                        isUploadingImages
                          ? 'border-primary bg-primary/10 cursor-wait'
                          : isDragging
                            ? 'border-primary bg-primary/10'
                            : 'border-muted-foreground/25 hover:border-primary/50'
                      }`}
                      onDragOver={handleDragOver}
                      onDragEnter={handleDragEnter}
                      onDragLeave={handleDragLeave}
                      onDrop={handleDrop}
                    >
                      {isUploadingImages ? (
                        <Loader2 className="h-6 w-6 text-primary animate-spin" />
                      ) : (
                        <>
                          <Plus className={`h-6 w-6 ${isDragging ? 'text-primary' : 'text-muted-foreground'}`} />
                          <span className="mt-1 text-xs text-muted-foreground">
                            {t('addImage')}
                          </span>
                        </>
                      )}
                      <input
                        type="file"
                        accept="image/*"
                        multiple
                        className="sr-only"
                        onChange={handleImageUpload}
                        disabled={isUploadingImages}
                      />
                    </label>
                  )}
                </div>
              )}

            <p className="text-xs text-muted-foreground">
              {t('imagesHint', { count: 5 - imagesPreviews.length })}
            </p>
          </div>
          {field.state.meta.errors.length > 0 && (
            <p className="text-sm font-medium text-destructive">
              {String(field.state.meta.errors[0])}
            </p>
          )}
        </div>
      )}
    </form.Field>
  )

  // Edit mode: simple form without stepper
  if (isEditMode) {
    return (
      <form.AppForm>
        <form.Form className="space-y-6">
          {/* Photos */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <ImageIcon className="h-5 w-5" />
                {t('photos')}
              </CardTitle>
              <CardDescription>{t('photosDescription')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {renderImageUpload()}

              {/* YouTube Video URL */}
              <div className="pt-4 border-t">
                <form.AppField name="videoUrl">
                  {(field) => (
                    <div className="space-y-2">
                      <Label className="flex items-center gap-2">
                        <Video className="h-4 w-4" />
                        {t('videoUrl')}
                      </Label>
                      <field.Input
                        placeholder={t('videoUrlPlaceholder')}
                      />
                      <p className="text-sm text-muted-foreground">{t('videoUrlHelp')}</p>
                    </div>
                  )}
                </form.AppField>
              </div>
            </CardContent>
          </Card>

          {/* Information */}
          <Card>
            <CardHeader>
              <CardTitle>{t('information')}</CardTitle>
              <CardDescription>{t('informationDescription')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <form.AppField name="name">
                {(field) => <field.Input label={t('name')} placeholder={t('namePlaceholder')} />}
              </form.AppField>

              <form.Field name="description">
                {(field) => (
                  <div className="space-y-2">
                    <Label>{t('description')}</Label>
                    <RichTextEditor
                      value={field.state.value || ''}
                      onChange={field.handleChange}
                      placeholder={t('descriptionPlaceholder')}
                    />
                    <p className="text-sm text-muted-foreground">{t('descriptionHint')}</p>
                    {field.state.meta.errors.length > 0 && (
                      <p className="text-sm font-medium text-destructive">
                        {String(field.state.meta.errors[0])}
                      </p>
                    )}
                  </div>
                )}
              </form.Field>

              <form.Field name="categoryId">
                {(field) => (
                  <div className="space-y-2">
                    <Label>{t('category')}</Label>
                    <div className="flex gap-2">
                      <Select
                        onValueChange={(value) => { if (value !== null) field.handleChange(value) }}
                        value={field.state.value || undefined}
                      >
                        <SelectTrigger className="flex-1">
                          <SelectValue placeholder={t('selectCategory')} />
                        </SelectTrigger>
                        <SelectContent>
                          {categories.map((category) => (
                            <SelectItem key={category.id} value={category.id}>
                              {category.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Dialog open={categoryDialogOpen} onOpenChange={setCategoryDialogOpen}>
                        <DialogTrigger render={<Button type="button" variant="outline" size="icon" />}>
                          <Plus className="h-4 w-4" />
                        </DialogTrigger>
                        <DialogContent>
                          <DialogHeader>
                            <DialogTitle>{t('newCategory')}</DialogTitle>
                            <DialogDescription>{t('newCategoryDescription')}</DialogDescription>
                          </DialogHeader>
                          <div className="py-4">
                            <Input
                              placeholder={t('categoryName')}
                              value={newCategoryName}
                              onChange={(e) => setNewCategoryName(e.target.value)}
                            />
                          </div>
                          <DialogFooter>
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => setCategoryDialogOpen(false)}
                            >
                              {tCommon('cancel')}
                            </Button>
                            <Button
                              type="button"
                              onClick={handleCreateCategory}
                              disabled={isCreatingCategory}
                            >
                              {isCreatingCategory && (
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                              )}
                              {tCommon('create')}
                            </Button>
                          </DialogFooter>
                        </DialogContent>
                      </Dialog>
                    </div>
                    <p className="text-sm text-muted-foreground">{t('categoryOptional')}</p>
                    {field.state.meta.errors.length > 0 && (
                      <p className="text-sm font-medium text-destructive">
                        {String(field.state.meta.errors[0])}
                      </p>
                    )}
                  </div>
                )}
              </form.Field>
            </CardContent>
          </Card>

          {/* Pricing & Stock - Two columns on larger screens */}
          <div className="grid gap-6 lg:grid-cols-2">
            {/* Tarification */}
            <Card>
              <CardHeader>
                <CardTitle>{t('pricing')}</CardTitle>
                <CardDescription>{t('pricingDescription')}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Pricing Mode first - determines the price label */}
                <form.Field name="pricingMode">
                  {(field) => (
                    <div className="space-y-2">
                      <Label>{t('pricingModeLabel')}</Label>
                      <Select
                        onValueChange={(value) => { if (value !== null) field.handleChange((value === 'inherit' ? null : value) as any) }}
                        value={field.state.value || 'inherit'}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder={t('pricingModeInherit')} />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="inherit">
                            {t('pricingModeInherit')} ({t(`pricingModes.${pricingMode}`)})
                          </SelectItem>
                          <SelectItem value="hour">{t('pricingModes.hour')}</SelectItem>
                          <SelectItem value="day">{t('pricingModes.day')}</SelectItem>
                          <SelectItem value="week">{t('pricingModes.week')}</SelectItem>
                        </SelectContent>
                      </Select>
                      <p className="text-sm text-muted-foreground">{t('pricingModeHelp')}</p>
                      {field.state.meta.errors.length > 0 && (
                        <p className="text-sm font-medium text-destructive">
                          {String(field.state.meta.errors[0])}
                        </p>
                      )}
                    </div>
                  )}
                </form.Field>

                <Separator />

                {/* Price and Deposit */}
                <div className="grid gap-4 sm:grid-cols-2">
                  <form.AppField name="price">
                    {(field) => (
                      <field.Input
                        label={priceLabel}
                        suffix={currencySymbol}
                        placeholder={t('pricePlaceholder')}
                        className="text-lg font-semibold"
                      />
                    )}
                  </form.AppField>

                  <form.AppField name="deposit">
                    {(field) => (
                      <field.Input
                        label={t('deposit')}
                        suffix={currencySymbol}
                        placeholder={t('depositPlaceholder')}
                        description={t('depositHelp')}
                      />
                    )}
                  </form.AppField>
                </div>

                {/* Tax Settings - only show if taxes are enabled at store level */}
                {storeTaxSettings?.enabled && (
                  <>
                    <Separator />
                    <div className="space-y-4">
                      <form.AppField name={"taxSettings.inheritFromStore" as any}>
                        {(field) => (
                          <field.Switch
                            label={t('inheritTax')}
                            description={t('inheritTaxDescription', { rate: storeTaxSettings.defaultRate })}
                          />
                        )}
                      </form.AppField>

                      {!watchedValues.taxSettings?.inheritFromStore && (
                        <form.Field name={"taxSettings.customRate" as any}>
                          {(field) => (
                            <div className="space-y-2">
                              <Label>{t('customTaxRate')}</Label>
                              <div className="relative w-32">
                                <Input
                                  type="number"
                                  min="0"
                                  max="100"
                                  step="0.01"
                                  placeholder="20"
                                  className="pr-8"
                                  value={field.state.value ?? ''}
                                  onChange={(e) => field.handleChange((e.target.value ? parseFloat(e.target.value) : undefined) as any)}
                                />
                                <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-muted-foreground">
                                  %
                                </span>
                              </div>
                              <p className="text-sm text-muted-foreground">{t('customTaxRateDescription')}</p>
                              {field.state.meta.errors.length > 0 && (
                                <p className="text-sm font-medium text-destructive">
                                  {String(field.state.meta.errors[0])}
                                </p>
                              )}
                            </div>
                          )}
                        </form.Field>
                      )}
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            {/* Stock */}
            <Card>
              <CardHeader>
                <CardTitle>{t('stock')}</CardTitle>
                <CardDescription>{t('quantityHelp')}</CardDescription>
              </CardHeader>
              <CardContent>
                <UnitTrackingEditor
                  trackUnits={watchedValues.trackUnits || false}
                  onTrackUnitsChange={(value) => form.setFieldValue('trackUnits', value)}
                  units={watchedValues.units || []}
                  onChange={(units) => form.setFieldValue('units', units)}
                  quantity={watchedValues.quantity || '1'}
                  onQuantityChange={(value) => form.setFieldValue('quantity', value)}
                  disabled={isLoading}
                />
              </CardContent>
            </Card>
          </div>

          {/* Progressive Discounts & Accessories - Side by side on large screens */}
          <div className="grid gap-6 xl:grid-cols-2">
            {/* Progressive Discounts */}
            <Card>
              <CardContent className="pt-6">
                <form.Field name="pricingTiers">
                  {(field) => (
                    <div>
                      <PricingTiersEditor
                        basePrice={basePrice}
                        pricingMode={effectivePricingMode}
                        tiers={field.state.value || []}
                        onChange={field.handleChange}
                        enforceStrictTiers={watchedValues.enforceStrictTiers || false}
                        onEnforceStrictTiersChange={(value) => form.setFieldValue('enforceStrictTiers', value)}
                        disabled={isLoading}
                      />
                      {field.state.meta.errors.length > 0 && (
                        <p className="text-sm font-medium text-destructive">
                          {String(field.state.meta.errors[0])}
                        </p>
                      )}
                    </div>
                  )}
                </form.Field>
              </CardContent>
            </Card>

            {/* Accessories */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Link2 className="h-5 w-5" />
                  {t('accessories')}
                </CardTitle>
                <CardDescription>{t('accessoriesDescription')}</CardDescription>
              </CardHeader>
              <CardContent>
                {availableAccessories.length > 0 ? (
                  <form.Field name="accessoryIds">
                    {(field) => (
                      <div>
                        <AccessoriesSelector
                          availableProducts={availableAccessories}
                          selectedIds={field.state.value || []}
                          onChange={field.handleChange}
                          currency={currency}
                          disabled={isLoading}
                        />
                        {field.state.meta.errors.length > 0 && (
                          <p className="text-sm font-medium text-destructive">
                            {String(field.state.meta.errors[0])}
                          </p>
                        )}
                      </div>
                    )}
                  </form.Field>
                ) : (
                  <div className="flex flex-col items-center justify-center py-8 text-center">
                    <div className="mb-3 rounded-full bg-muted p-3">
                      <Puzzle className="h-6 w-6 text-muted-foreground" />
                    </div>
                    <p className="text-sm font-medium">
                      {t('noAccessoriesAvailable')}
                    </p>
                    <p className="mt-1 max-w-[260px] text-sm text-muted-foreground">
                      {t('noAccessoriesHint')}
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Status */}
          <Card>
            <CardHeader>
              <CardTitle>{t('publication')}</CardTitle>
              <CardDescription>{t('publicationDescription')}</CardDescription>
            </CardHeader>
            <CardContent>
              <form.Field name="status">
                {(field) => (
                  <div>
                    <RadioGroup
                      onValueChange={(value) => field.handleChange(value)}
                      defaultValue={field.state.value}
                      className="grid gap-4 sm:grid-cols-3"
                    >
                      <label
                        htmlFor="active-edit"
                        className={`flex items-center space-x-3 rounded-lg border p-4 cursor-pointer transition-colors ${
                          field.state.value === 'active'
                            ? 'border-primary bg-primary/5'
                            : 'hover:bg-muted/50'
                        }`}
                      >
                        <RadioGroupItem value="active" id="active-edit" />
                        <span className="font-medium">{t('statusActive')}</span>
                      </label>

                      <label
                        htmlFor="draft-edit"
                        className={`flex items-center space-x-3 rounded-lg border p-4 cursor-pointer transition-colors ${
                          field.state.value === 'draft'
                            ? 'border-primary bg-primary/5'
                            : 'hover:bg-muted/50'
                        }`}
                      >
                        <RadioGroupItem value="draft" id="draft-edit" />
                        <span className="font-medium">{t('statusDraft')}</span>
                      </label>

                      <label
                        htmlFor="archived-edit"
                        className={`flex items-center space-x-3 rounded-lg border p-4 cursor-pointer transition-colors ${
                          field.state.value === 'archived'
                            ? 'border-primary bg-primary/5'
                            : 'hover:bg-muted/50'
                        }`}
                      >
                        <RadioGroupItem value="archived" id="archived-edit" />
                        <span className="font-medium">{t('statusArchived')}</span>
                      </label>
                    </RadioGroup>
                    {field.state.meta.errors.length > 0 && (
                      <p className="text-sm font-medium text-destructive">
                        {String(field.state.meta.errors[0])}
                      </p>
                    )}
                  </div>
                )}
              </form.Field>
            </CardContent>
          </Card>

          <FloatingSaveBar
            isDirty={isDirty}
            isLoading={isLoading}
            onReset={handleReset}
          />
        </form.Form>
      </form.AppForm>
    )
  }

  // Create mode: stepper flow
  return (
    <form.AppForm>
      <form.Form className="space-y-6">
        {/* Stepper */}
        <Card>
          <CardContent className="pt-6">
            <Stepper
              steps={STEPS}
              currentStep={currentStep}
              onStepClick={(step) => {
                if (step < currentStep) {
                  setCurrentStep(step)
                }
              }}
            />
          </CardContent>
        </Card>

        {/* Step Content */}
        {currentStep === 0 && (
          <StepContent>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ImageIcon className="h-5 w-5" />
                  {t('photos')}
                </CardTitle>
                <CardDescription>{t('photosDescription')}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {renderImageUpload()}

                {/* YouTube Video URL */}
                <div className="pt-4 border-t">
                  <form.AppField name="videoUrl">
                    {(field) => (
                      <div className="space-y-2">
                        <Label className="flex items-center gap-2">
                          <Video className="h-4 w-4" />
                          {t('videoUrl')}
                        </Label>
                        <field.Input
                          placeholder={t('videoUrlPlaceholder')}
                        />
                        <p className="text-sm text-muted-foreground">{t('videoUrlHelp')}</p>
                      </div>
                    )}
                  </form.AppField>
                </div>
              </CardContent>
            </Card>
          </StepContent>
        )}

        {currentStep === 1 && (
          <StepContent>
            <Card>
              <CardHeader>
                <CardTitle>{t('information')}</CardTitle>
                <CardDescription>{t('informationDescription')}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <form.AppField name="name">
                  {(field) => <field.Input label={t('name')} placeholder={t('namePlaceholder')} />}
                </form.AppField>

                <form.Field name="description">
                  {(field) => (
                    <div className="space-y-2">
                      <Label>{t('description')}</Label>
                      <RichTextEditor
                        value={field.state.value || ''}
                        onChange={field.handleChange}
                        placeholder={t('descriptionPlaceholder')}
                      />
                      <p className="text-sm text-muted-foreground">{t('descriptionHint')}</p>
                      {field.state.meta.errors.length > 0 && (
                        <p className="text-sm font-medium text-destructive">
                          {String(field.state.meta.errors[0])}
                        </p>
                      )}
                    </div>
                  )}
                </form.Field>

                <form.Field name="categoryId">
                  {(field) => (
                    <div className="space-y-2">
                      <Label>{t('category')}</Label>
                      <div className="flex gap-2">
                        <Select
                          onValueChange={(value) => { if (value !== null) field.handleChange(value) }}
                          value={field.state.value || undefined}
                        >
                          <SelectTrigger className="flex-1">
                            <SelectValue placeholder={t('selectCategory')} />
                          </SelectTrigger>
                          <SelectContent>
                            {categories.map((category) => (
                              <SelectItem key={category.id} value={category.id}>
                                {category.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Dialog open={categoryDialogOpen} onOpenChange={setCategoryDialogOpen}>
                          <DialogTrigger render={<Button type="button" variant="outline" size="icon" />}>
                              <Plus className="h-4 w-4" />
                          </DialogTrigger>
                          <DialogContent>
                            <DialogHeader>
                              <DialogTitle>{t('newCategory')}</DialogTitle>
                              <DialogDescription>{t('newCategoryDescription')}</DialogDescription>
                            </DialogHeader>
                            <div className="py-4">
                              <Input
                                placeholder={t('categoryName')}
                                value={newCategoryName}
                                onChange={(e) => setNewCategoryName(e.target.value)}
                              />
                            </div>
                            <DialogFooter>
                              <Button
                                type="button"
                                variant="outline"
                                onClick={() => setCategoryDialogOpen(false)}
                              >
                                {tCommon('cancel')}
                              </Button>
                              <Button
                                type="button"
                                onClick={handleCreateCategory}
                                disabled={isCreatingCategory}
                              >
                                {isCreatingCategory && (
                                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                )}
                                {tCommon('create')}
                              </Button>
                            </DialogFooter>
                          </DialogContent>
                        </Dialog>
                      </div>
                      <p className="text-sm text-muted-foreground">{t('categoryOptional')}</p>
                      {field.state.meta.errors.length > 0 && (
                        <p className="text-sm font-medium text-destructive">
                          {String(field.state.meta.errors[0])}
                        </p>
                      )}
                    </div>
                  )}
                </form.Field>
              </CardContent>
            </Card>
          </StepContent>
        )}

        {currentStep === 2 && (
          <StepContent>
            <div className="space-y-6">
              {/* Pricing & Stock - Two columns on larger screens */}
              <div className="grid gap-6 lg:grid-cols-2">
                {/* Tarification */}
                <Card>
                  <CardHeader>
                    <CardTitle>{t('pricing')}</CardTitle>
                    <CardDescription>{t('pricingDescription')}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    {/* Pricing Mode first */}
                    <form.Field name="pricingMode">
                      {(field) => (
                        <div className="space-y-2">
                          <Label>{t('pricingModeLabel')}</Label>
                          <Select
                            onValueChange={(value) => { if (value !== null) field.handleChange(value === 'inherit' ? null : value as any) }}
                            value={field.state.value || 'inherit'}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder={t('pricingModeInherit')} />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="inherit">
                                {t('pricingModeInherit')} ({t(`pricingModes.${pricingMode}`)})
                              </SelectItem>
                              <SelectItem value="hour">{t('pricingModes.hour')}</SelectItem>
                              <SelectItem value="day">{t('pricingModes.day')}</SelectItem>
                              <SelectItem value="week">{t('pricingModes.week')}</SelectItem>
                            </SelectContent>
                          </Select>
                          <p className="text-sm text-muted-foreground">{t('pricingModeHelp')}</p>
                          {field.state.meta.errors.length > 0 && (
                            <p className="text-sm font-medium text-destructive">{String(field.state.meta.errors[0])}</p>
                          )}
                        </div>
                      )}
                    </form.Field>

                    <Separator />

                    {/* Price and Deposit */}
                    <div className="grid gap-4 sm:grid-cols-2">
                      <form.AppField name="price">
                        {(field) => (
                          <field.Input
                            label={priceLabel}
                            suffix={currencySymbol}
                            placeholder={t('pricePlaceholder')}
                            className="text-lg font-semibold"
                          />
                        )}
                      </form.AppField>

                      <form.AppField name="deposit">
                        {(field) => (
                          <field.Input
                            label={t('deposit')}
                            suffix={currencySymbol}
                            placeholder={t('depositPlaceholder')}
                            description={t('depositHelp')}
                          />
                        )}
                      </form.AppField>
                    </div>

                    {/* Tax Settings - only show if taxes are enabled at store level */}
                    {storeTaxSettings?.enabled && (
                      <>
                        <Separator />
                        <div className="space-y-4">
                          <form.AppField name="taxSettings.inheritFromStore">
                            {(field) => (
                              <field.Switch
                                label={t('inheritTax')}
                                description={t('inheritTaxDescription', { rate: storeTaxSettings.defaultRate })}
                              />
                            )}
                          </form.AppField>

                          {!watchedValues.taxSettings?.inheritFromStore && (
                            <form.Field name="taxSettings.customRate">
                              {(field) => (
                                <div className="space-y-2">
                                  <Label>{t('customTaxRate')}</Label>
                                  <div className="relative w-32">
                                    <Input
                                      type="number"
                                      min="0"
                                      max="100"
                                      step="0.01"
                                      placeholder="20"
                                      className="pr-8"
                                      value={field.state.value ?? ''}
                                      onChange={(e) => field.handleChange(e.target.value ? parseFloat(e.target.value) : undefined)}
                                      onBlur={field.handleBlur}
                                    />
                                    <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-muted-foreground">
                                      %
                                    </span>
                                  </div>
                                  <p className="text-sm text-muted-foreground">{t('customTaxRateDescription')}</p>
                                  {field.state.meta.errors.length > 0 && (
                                    <p className="text-sm font-medium text-destructive">{String(field.state.meta.errors[0])}</p>
                                  )}
                                </div>
                              )}
                            </form.Field>
                          )}
                        </div>
                      </>
                    )}
                  </CardContent>
                </Card>

                {/* Stock */}
                <Card>
                  <CardHeader>
                    <CardTitle>{t('stock')}</CardTitle>
                    <CardDescription>{t('quantityHelp')}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <UnitTrackingEditor
                      trackUnits={watchedValues.trackUnits || false}
                      onTrackUnitsChange={(value) => form.setFieldValue('trackUnits', value)}
                      units={watchedValues.units || []}
                      onChange={(units) => form.setFieldValue('units', units)}
                      quantity={watchedValues.quantity || '1'}
                      onQuantityChange={(value) => form.setFieldValue('quantity', value)}
                      disabled={isLoading}
                    />
                  </CardContent>
                </Card>
              </div>

              {/* Progressive Discounts */}
              <Card>
                <CardContent className="pt-6">
                  <form.Field name="pricingTiers">
                    {(field) => (
                      <div>
                        <PricingTiersEditor
                          basePrice={basePrice}
                          pricingMode={effectivePricingMode}
                          tiers={field.state.value || []}
                          onChange={field.handleChange}
                          enforceStrictTiers={watchedValues.enforceStrictTiers || false}
                          onEnforceStrictTiersChange={(value) => form.setFieldValue('enforceStrictTiers', value)}
                          disabled={isLoading}
                        />
                        {field.state.meta.errors.length > 0 && (
                          <p className="text-sm font-medium text-destructive">{String(field.state.meta.errors[0])}</p>
                        )}
                      </div>
                    )}
                  </form.Field>
                </CardContent>
              </Card>
            </div>
          </StepContent>
        )}

        {currentStep === 3 && (
          <StepContent>
            <div className="grid gap-6 lg:grid-cols-2">
              {/* Preview */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Eye className="h-5 w-5" />
                    {t('previewTitle')}
                  </CardTitle>
                  <CardDescription>{t('previewDescription')}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {/* Product preview card */}
                    <div className="rounded-lg border overflow-hidden">
                      {imagesPreviews.length > 0 ? (
                        <div className="aspect-video relative bg-muted">
                          <img
                            src={imagesPreviews[0]}
                            alt={watchedValues.name}
                            className="w-full h-full object-cover"
                          />
                        </div>
                      ) : (
                        <div className="aspect-video flex items-center justify-center bg-muted">
                          <Package className="h-12 w-12 text-muted-foreground" />
                        </div>
                      )}
                      <div className="p-4 space-y-2">
                        <div className="flex items-start justify-between">
                          <div>
                            <h3 className="font-semibold">
                              {watchedValues.name || t('noName')}
                            </h3>
                            {selectedCategory && (
                              <Badge variant="secondary" className="mt-1">
                                {selectedCategory.name}
                              </Badge>
                            )}
                          </div>
                          <div className="text-right">
                            <p className="font-bold text-lg">
                              {formatCurrency(parseFloat(watchedValues.price) || 0)}
                            </p>
                            <p className="text-xs text-muted-foreground">{priceLabel}</p>
                          </div>
                        </div>
                        {watchedValues.description && (
                          <div
                            className="text-sm text-muted-foreground prose prose-sm max-w-none line-clamp-3"
                            dangerouslySetInnerHTML={{ __html: watchedValues.description }}
                          />
                        )}
                      </div>
                    </div>

                    <Separator />

                    {/* Summary */}
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">{t('deposit')}</span>
                        <span>{formatCurrency(parseFloat(watchedValues.deposit || '0') || 0)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">{t('quantity')}</span>
                        <span>{watchedValues.quantity} {t('units')}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">{t('photos')}</span>
                        <span>{imagesPreviews.length} / 5</span>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Publication settings */}
              <Card>
                <CardHeader>
                  <CardTitle>{t('publication')}</CardTitle>
                  <CardDescription>{t('publicationDescription')}</CardDescription>
                </CardHeader>
                <CardContent>
                  <form.Field name="status">
                    {(field) => (
                      <div>
                        <RadioGroup
                          onValueChange={(value) => field.handleChange(value as any)}
                          defaultValue={field.state.value}
                          className="space-y-4"
                        >
                          <label
                            htmlFor="active"
                            className={`flex items-start space-x-4 rounded-lg border p-4 cursor-pointer transition-colors ${
                              field.state.value === 'active'
                                ? 'border-primary bg-primary/5'
                                : 'hover:bg-muted/50'
                            }`}
                          >
                            <RadioGroupItem value="active" id="active" className="mt-1" />
                            <div className="flex-1">
                              <div className="flex items-center gap-2">
                                <span className="font-medium">{t('statusActive')}</span>
                                <Badge variant="default" className="text-xs">
                                  {t('recommended')}
                                </Badge>
                              </div>
                              <p className="text-sm text-muted-foreground mt-1">
                                {t('statusActiveDescription')}
                              </p>
                            </div>
                          </label>

                          <label
                            htmlFor="draft"
                            className={`flex items-start space-x-4 rounded-lg border p-4 cursor-pointer transition-colors ${
                              field.state.value === 'draft'
                                ? 'border-primary bg-primary/5'
                                : 'hover:bg-muted/50'
                            }`}
                          >
                            <RadioGroupItem value="draft" id="draft" className="mt-1" />
                            <div className="flex-1">
                              <span className="font-medium">{t('statusDraft')}</span>
                              <p className="text-sm text-muted-foreground mt-1">
                                {t('statusDraftDescription')}
                              </p>
                            </div>
                          </label>

                          <label
                            htmlFor="archived"
                            className={`flex items-start space-x-4 rounded-lg border p-4 cursor-pointer transition-colors ${
                              field.state.value === 'archived'
                                ? 'border-primary bg-primary/5'
                                : 'hover:bg-muted/50'
                            }`}
                          >
                            <RadioGroupItem value="archived" id="archived" className="mt-1" />
                            <div className="flex-1">
                              <span className="font-medium">{t('statusArchived')}</span>
                              <p className="text-sm text-muted-foreground mt-1">
                                {t('statusArchivedDescription')}
                              </p>
                            </div>
                          </label>
                        </RadioGroup>
                        {field.state.meta.errors.length > 0 && (
                          <p className="text-sm font-medium text-destructive">{String(field.state.meta.errors[0])}</p>
                        )}
                      </div>
                    )}
                  </form.Field>
                </CardContent>
              </Card>
            </div>
          </StepContent>
        )}

        {/* Navigation */}
        <StepActions>
          <div>
            {currentStep > 0 ? (
              <Button type="button" variant="outline" onClick={goToPreviousStep}>
                <ArrowLeft className="mr-2 h-4 w-4" />
                {t('previous')}
              </Button>
            ) : (
              <Button
                type="button"
                variant="outline"
                onClick={() => router.push('/dashboard/products')}
              >
                {tCommon('cancel')}
              </Button>
            )}
          </div>

          <div className="flex gap-3">
            {currentStep < STEPS.length - 1 ? (
              <Button type="button" onClick={goToNextStep}>
                {t('next')}
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            ) : (
              <Button type="submit" disabled={isLoading}>
                {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                <Check className="mr-2 h-4 w-4" />
                {product ? t('save') : t('createProduct')}
              </Button>
            )}
          </div>
        </StepActions>
      </form.Form>
    </form.AppForm>
  )
}
