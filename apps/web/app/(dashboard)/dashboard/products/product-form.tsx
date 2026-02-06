'use client'

import { useState, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { useForm, type FieldErrors } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
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
import { toast } from 'sonner'
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
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@louez/ui'
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

  const form = useForm<ProductInput>({
    resolver: zodResolver(productSchema),
    defaultValues: {
      name: product?.name || '',
      description: product?.description || '',
      categoryId: product?.categoryId || null,
      price: product?.price || '',
      deposit: product?.deposit || '',
      quantity: product?.quantity?.toString() || '1',
      status: product?.status || 'draft',
      images: product?.images ?? [],
      pricingMode: product?.pricingMode || null,
      pricingTiers: initialPricingTiers,
      enforceStrictTiers: product?.enforceStrictTiers || false,
      taxSettings: product?.taxSettings || { inheritFromStore: true },
      videoUrl: product?.videoUrl || '',
      accessoryIds: product?.accessoryIds || [],
      trackUnits: product?.trackUnits || false,
      units: initialUnits,
    },
  })

  const { isDirty } = form.formState

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
            toast.error(t('imageError'))
            continue
          }

          if (file.size > 15 * 1024 * 1024) {
            toast.error(t('imageSizeError'))
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
          form.setValue('images', updatedPreviews, { shouldDirty: true })
        }
      } catch (error) {
        console.error('Image upload error:', error)
        toast.error(t('imageUploadError'))
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
    form.setValue('images', newPreviews, { shouldDirty: true })
  }

  const setMainImage = (index: number) => {
    if (index === 0) return
    const newPreviews = [...imagesPreviews]
    const [moved] = newPreviews.splice(index, 1)
    newPreviews.unshift(moved)
    setImagesPreviews(newPreviews)
    form.setValue('images', newPreviews, { shouldDirty: true })
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
        toast.error(result.error)
      } else {
        toast.success(t('categoryCreated'))
        setNewCategoryName('')
        setCategoryDialogOpen(false)
        router.refresh()
      }
    } catch {
      toast.error(tErrors('generic'))
    } finally {
      setIsCreatingCategory(false)
    }
  }

  const validateCurrentStep = async (): Promise<boolean> => {
    let fieldsToValidate: (keyof ProductInput)[] = []

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

    const result = await form.trigger(fieldsToValidate)
    return result
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

  function onInvalid(errors: FieldErrors<ProductInput>) {
    toast.error(t('validationError'))

    // In stepper mode: navigate to the first step with errors
    if (!isEditMode) {
      const errorFields = Object.keys(errors)
      const stepForField = (field: string): number => {
        if (['images', 'videoUrl'].includes(field)) return 0
        if (['name', 'description', 'categoryId'].includes(field)) return 1
        if (['price', 'deposit', 'quantity', 'pricingMode', 'pricingTiers', 'taxSettings', 'trackUnits', 'units', 'enforceStrictTiers'].includes(field)) return 2
        if (['status'].includes(field)) return 3
        return currentStep
      }

      const firstErrorStep = Math.min(...errorFields.map(stepForField))
      if (firstErrorStep < currentStep) {
        setCurrentStep(firstErrorStep)
      }
    }
  }

  async function onSubmit(data: ProductInput) {
    setIsLoading(true)
    try {
      const result = product
        ? await updateProduct(product.id, data)
        : await createProduct(data)

      if (result.error) {
        toast.error(result.error)
        return
      }

      toast.success(product ? t('productUpdated') : t('productCreated'))
      router.push('/dashboard/products')
    } catch {
      toast.error(tErrors('generic'))
    } finally {
      setIsLoading(false)
    }
  }

  const watchedValues = form.watch()
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
    <FormField
      control={form.control}
      name="images"
      render={() => (
        <FormItem>
          <FormControl>
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
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  )

  // Edit mode: simple form without stepper
  if (isEditMode) {
    return (
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit, onInvalid)} className="space-y-6">
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
                <FormField
                  control={form.control}
                  name="videoUrl"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="flex items-center gap-2">
                        <Video className="h-4 w-4" />
                        {t('videoUrl')}
                      </FormLabel>
                      <FormControl>
                        <Input
                          placeholder={t('videoUrlPlaceholder')}
                          {...field}
                        />
                      </FormControl>
                      <FormDescription>{t('videoUrlHelp')}</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
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
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('name')}</FormLabel>
                    <FormControl>
                      <Input placeholder={t('namePlaceholder')} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="description"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('description')}</FormLabel>
                    <FormControl>
                      <RichTextEditor
                        value={field.value || ''}
                        onChange={field.onChange}
                        placeholder={t('descriptionPlaceholder')}
                      />
                    </FormControl>
                    <FormDescription>{t('descriptionHint')}</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="categoryId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>{t('category')}</FormLabel>
                    <div className="flex gap-2">
                      <Select onValueChange={field.onChange} value={field.value || undefined}>
                        <FormControl>
                          <SelectTrigger className="flex-1">
                            <SelectValue placeholder={t('selectCategory')} />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {categories.map((category) => (
                            <SelectItem key={category.id} value={category.id}>
                              {category.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Dialog open={categoryDialogOpen} onOpenChange={setCategoryDialogOpen}>
                        <DialogTrigger asChild>
                          <Button type="button" variant="outline" size="icon">
                            <Plus className="h-4 w-4" />
                          </Button>
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
                    <FormDescription>{t('categoryOptional')}</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
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
                <FormField
                  control={form.control}
                  name="pricingMode"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('pricingModeLabel')}</FormLabel>
                      <Select
                        onValueChange={(value) => field.onChange(value === 'inherit' ? null : value)}
                        value={field.value || 'inherit'}
                      >
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder={t('pricingModeInherit')} />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="inherit">
                            {t('pricingModeInherit')} ({t(`pricingModes.${pricingMode}`)})
                          </SelectItem>
                          <SelectItem value="hour">{t('pricingModes.hour')}</SelectItem>
                          <SelectItem value="day">{t('pricingModes.day')}</SelectItem>
                          <SelectItem value="week">{t('pricingModes.week')}</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormDescription>{t('pricingModeHelp')}</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <Separator />

                {/* Price and Deposit */}
                <div className="grid gap-4 sm:grid-cols-2">
                  <FormField
                    control={form.control}
                    name="price"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{priceLabel}</FormLabel>
                        <FormControl>
                          <div className="relative">
                            <Input
                              placeholder={t('pricePlaceholder')}
                              className="pr-8 text-lg font-semibold"
                              {...field}
                            />
                            <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-muted-foreground">
                              {currencySymbol}
                            </span>
                          </div>
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />

                  <FormField
                    control={form.control}
                    name="deposit"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>{t('deposit')}</FormLabel>
                        <FormControl>
                          <div className="relative">
                            <Input
                              placeholder={t('depositPlaceholder')}
                              className="pr-8"
                              {...field}
                            />
                            <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-muted-foreground">
                              {currencySymbol}
                            </span>
                          </div>
                        </FormControl>
                        <FormDescription>{t('depositHelp')}</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>

                {/* Tax Settings - only show if taxes are enabled at store level */}
                {storeTaxSettings?.enabled && (
                  <>
                    <Separator />
                    <div className="space-y-4">
                      <FormField
                        control={form.control}
                        name="taxSettings.inheritFromStore"
                        render={({ field }) => (
                          <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                            <div className="space-y-0.5">
                              <FormLabel className="text-base">{t('inheritTax')}</FormLabel>
                              <FormDescription>
                                {t('inheritTaxDescription', { rate: storeTaxSettings.defaultRate })}
                              </FormDescription>
                            </div>
                            <FormControl>
                              <Switch
                                checked={field.value}
                                onCheckedChange={field.onChange}
                              />
                            </FormControl>
                          </FormItem>
                        )}
                      />

                      {!watchedValues.taxSettings?.inheritFromStore && (
                        <FormField
                          control={form.control}
                          name="taxSettings.customRate"
                          render={({ field }) => (
                            <FormItem>
                              <FormLabel>{t('customTaxRate')}</FormLabel>
                              <FormControl>
                                <div className="relative w-32">
                                  <Input
                                    type="number"
                                    min="0"
                                    max="100"
                                    step="0.01"
                                    placeholder="20"
                                    className="pr-8"
                                    {...field}
                                    value={field.value ?? ''}
                                    onChange={(e) => field.onChange(e.target.value ? parseFloat(e.target.value) : undefined)}
                                  />
                                  <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-muted-foreground">
                                    %
                                  </span>
                                </div>
                              </FormControl>
                              <FormDescription>{t('customTaxRateDescription')}</FormDescription>
                              <FormMessage />
                            </FormItem>
                          )}
                        />
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
                  onTrackUnitsChange={(value) => form.setValue('trackUnits', value, { shouldDirty: true })}
                  units={watchedValues.units || []}
                  onChange={(units) => form.setValue('units', units, { shouldDirty: true })}
                  quantity={watchedValues.quantity || '1'}
                  onQuantityChange={(value) => form.setValue('quantity', value, { shouldDirty: true })}
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
                <FormField
                  control={form.control}
                  name="pricingTiers"
                  render={({ field }) => (
                    <FormItem>
                      <FormControl>
                        <PricingTiersEditor
                          basePrice={basePrice}
                          pricingMode={effectivePricingMode}
                          tiers={field.value || []}
                          onChange={field.onChange}
                          enforceStrictTiers={form.watch('enforceStrictTiers') || false}
                          onEnforceStrictTiersChange={(value) => form.setValue('enforceStrictTiers', value, { shouldDirty: true })}
                          disabled={isLoading}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
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
                  <FormField
                    control={form.control}
                    name="accessoryIds"
                    render={({ field }) => (
                      <FormItem>
                        <FormControl>
                          <AccessoriesSelector
                            availableProducts={availableAccessories}
                            selectedIds={field.value || []}
                            onChange={field.onChange}
                            currency={currency}
                            disabled={isLoading}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
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
              <FormField
                control={form.control}
                name="status"
                render={({ field }) => (
                  <FormItem>
                    <FormControl>
                      <RadioGroup
                        onValueChange={field.onChange}
                        defaultValue={field.value}
                        className="grid gap-4 sm:grid-cols-3"
                      >
                        <label
                          htmlFor="active-edit"
                          className={`flex items-center space-x-3 rounded-lg border p-4 cursor-pointer transition-colors ${
                            field.value === 'active'
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
                            field.value === 'draft'
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
                            field.value === 'archived'
                              ? 'border-primary bg-primary/5'
                              : 'hover:bg-muted/50'
                          }`}
                        >
                          <RadioGroupItem value="archived" id="archived-edit" />
                          <span className="font-medium">{t('statusArchived')}</span>
                        </label>
                      </RadioGroup>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>

          <FloatingSaveBar
            isDirty={isDirty}
            isLoading={isLoading}
            onReset={handleReset}
          />
        </form>
      </Form>
    )
  }

  // Create mode: stepper flow
  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit, onInvalid)} className="space-y-6">
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
                  <FormField
                    control={form.control}
                    name="videoUrl"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel className="flex items-center gap-2">
                          <Video className="h-4 w-4" />
                          {t('videoUrl')}
                        </FormLabel>
                        <FormControl>
                          <Input
                            placeholder={t('videoUrlPlaceholder')}
                            {...field}
                          />
                        </FormControl>
                        <FormDescription>{t('videoUrlHelp')}</FormDescription>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
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
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('name')}</FormLabel>
                      <FormControl>
                        <Input placeholder={t('namePlaceholder')} {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="description"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('description')}</FormLabel>
                      <FormControl>
                        <RichTextEditor
                          value={field.value || ''}
                          onChange={field.onChange}
                          placeholder={t('descriptionPlaceholder')}
                        />
                      </FormControl>
                      <FormDescription>{t('descriptionHint')}</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                <FormField
                  control={form.control}
                  name="categoryId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('category')}</FormLabel>
                      <div className="flex gap-2">
                        <Select onValueChange={field.onChange} value={field.value || undefined}>
                          <FormControl>
                            <SelectTrigger className="flex-1">
                              <SelectValue placeholder={t('selectCategory')} />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {categories.map((category) => (
                              <SelectItem key={category.id} value={category.id}>
                                {category.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Dialog open={categoryDialogOpen} onOpenChange={setCategoryDialogOpen}>
                          <DialogTrigger asChild>
                            <Button type="button" variant="outline" size="icon">
                              <Plus className="h-4 w-4" />
                            </Button>
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
                      <FormDescription>{t('categoryOptional')}</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
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
                    <FormField
                      control={form.control}
                      name="pricingMode"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>{t('pricingModeLabel')}</FormLabel>
                          <Select
                            onValueChange={(value) => field.onChange(value === 'inherit' ? null : value)}
                            value={field.value || 'inherit'}
                          >
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder={t('pricingModeInherit')} />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              <SelectItem value="inherit">
                                {t('pricingModeInherit')} ({t(`pricingModes.${pricingMode}`)})
                              </SelectItem>
                              <SelectItem value="hour">{t('pricingModes.hour')}</SelectItem>
                              <SelectItem value="day">{t('pricingModes.day')}</SelectItem>
                              <SelectItem value="week">{t('pricingModes.week')}</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormDescription>{t('pricingModeHelp')}</FormDescription>
                          <FormMessage />
                        </FormItem>
                      )}
                    />

                    <Separator />

                    {/* Price and Deposit */}
                    <div className="grid gap-4 sm:grid-cols-2">
                      <FormField
                        control={form.control}
                        name="price"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>{priceLabel}</FormLabel>
                            <FormControl>
                              <div className="relative">
                                <Input
                                  placeholder={t('pricePlaceholder')}
                                  className="pr-8 text-lg font-semibold"
                                  {...field}
                                />
                                <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-muted-foreground">
                                  {currencySymbol}
                                </span>
                              </div>
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />

                      <FormField
                        control={form.control}
                        name="deposit"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>{t('deposit')}</FormLabel>
                            <FormControl>
                              <div className="relative">
                                <Input
                                  placeholder={t('depositPlaceholder')}
                                  className="pr-8"
                                  {...field}
                                />
                                <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-muted-foreground">
                                  {currencySymbol}
                                </span>
                              </div>
                            </FormControl>
                            <FormDescription>{t('depositHelp')}</FormDescription>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    </div>

                    {/* Tax Settings - only show if taxes are enabled at store level */}
                    {storeTaxSettings?.enabled && (
                      <>
                        <Separator />
                        <div className="space-y-4">
                          <FormField
                            control={form.control}
                            name="taxSettings.inheritFromStore"
                            render={({ field }) => (
                              <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
                                <div className="space-y-0.5">
                                  <FormLabel className="text-base">{t('inheritTax')}</FormLabel>
                                  <FormDescription>
                                    {t('inheritTaxDescription', { rate: storeTaxSettings.defaultRate })}
                                  </FormDescription>
                                </div>
                                <FormControl>
                                  <Switch
                                    checked={field.value}
                                    onCheckedChange={field.onChange}
                                  />
                                </FormControl>
                              </FormItem>
                            )}
                          />

                          {!watchedValues.taxSettings?.inheritFromStore && (
                            <FormField
                              control={form.control}
                              name="taxSettings.customRate"
                              render={({ field }) => (
                                <FormItem>
                                  <FormLabel>{t('customTaxRate')}</FormLabel>
                                  <FormControl>
                                    <div className="relative w-32">
                                      <Input
                                        type="number"
                                        min="0"
                                        max="100"
                                        step="0.01"
                                        placeholder="20"
                                        className="pr-8"
                                        {...field}
                                        value={field.value ?? ''}
                                        onChange={(e) => field.onChange(e.target.value ? parseFloat(e.target.value) : undefined)}
                                      />
                                      <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-muted-foreground">
                                        %
                                      </span>
                                    </div>
                                  </FormControl>
                                  <FormDescription>{t('customTaxRateDescription')}</FormDescription>
                                  <FormMessage />
                                </FormItem>
                              )}
                            />
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
                      onTrackUnitsChange={(value) => form.setValue('trackUnits', value, { shouldDirty: true })}
                      units={watchedValues.units || []}
                      onChange={(units) => form.setValue('units', units, { shouldDirty: true })}
                      quantity={watchedValues.quantity || '1'}
                      onQuantityChange={(value) => form.setValue('quantity', value, { shouldDirty: true })}
                      disabled={isLoading}
                    />
                  </CardContent>
                </Card>
              </div>

              {/* Progressive Discounts */}
              <Card>
                <CardContent className="pt-6">
                  <FormField
                    control={form.control}
                    name="pricingTiers"
                    render={({ field }) => (
                      <FormItem>
                        <FormControl>
                          <PricingTiersEditor
                            basePrice={basePrice}
                            pricingMode={effectivePricingMode}
                            tiers={field.value || []}
                            onChange={field.onChange}
                            enforceStrictTiers={form.watch('enforceStrictTiers') || false}
                            onEnforceStrictTiersChange={(value) => form.setValue('enforceStrictTiers', value, { shouldDirty: true })}
                            disabled={isLoading}
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
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
                  <FormField
                    control={form.control}
                    name="status"
                    render={({ field }) => (
                      <FormItem>
                        <FormControl>
                          <RadioGroup
                            onValueChange={field.onChange}
                            defaultValue={field.value}
                            className="space-y-4"
                          >
                            <label
                              htmlFor="active"
                              className={`flex items-start space-x-4 rounded-lg border p-4 cursor-pointer transition-colors ${
                                field.value === 'active'
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
                                field.value === 'draft'
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
                                field.value === 'archived'
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
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
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
      </form>
    </Form>
  )
}
