'use client'

import { useState, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ClipboardCheck,
  Package,
  FileCheck,
  PenLine,
  Loader2,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react'
import { cn } from '@louez/utils'
import { Button } from '@louez/ui'
import { Textarea } from '@louez/ui'
import { Label } from '@louez/ui'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@louez/ui'
import { Badge } from '@louez/ui'
import { Progress } from '@louez/ui'
import {
  QuickConditionSelector,
  quickToFullCondition,
  fullToQuickCondition,
} from './condition-selector'
import { PhotoCapture, type CapturedPhoto } from './photo-capture'
import { SignaturePad } from './signature-pad'
import type { ConditionRating, InspectionType } from '@louez/types'

// ============================================================================
// Types
// ============================================================================

interface ReservationItem {
  id: string
  quantity: number
  product: {
    id: string
    name: string
    images: string[]
  }
}

interface InspectionWizardProps {
  reservationId: string
  reservationNumber: string
  customerName: string
  type: InspectionType
  items: ReservationItem[]
  requireSignature: boolean
  maxPhotosPerItem: number
  onComplete?: () => void
}

interface ItemInspection {
  reservationItemId: string
  condition: 'ok' | 'wear' | 'damage'
  notes: string
  photos: CapturedPhoto[]
}

type WizardStep = 'overview' | 'items' | 'summary' | 'signature'

const STEPS: WizardStep[] = ['overview', 'items', 'summary', 'signature']

// ============================================================================
// Step Components
// ============================================================================

interface StepOverviewProps {
  type: InspectionType
  reservationNumber: string
  customerName: string
  itemCount: number
  onAllOk: () => void
}

function StepOverview({
  type,
  reservationNumber,
  customerName,
  itemCount,
  onAllOk,
}: StepOverviewProps) {
  const t = useTranslations('dashboard.settings.inspection')

  return (
    <div className="space-y-6">
      {/* Header info */}
      <div className="rounded-2xl bg-gradient-to-br from-primary/10 via-primary/5 to-transparent p-6">
        <div className="flex items-start gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/20">
            <ClipboardCheck className="h-6 w-6 text-primary" />
          </div>
          <div className="flex-1 space-y-1">
            <h3 className="font-semibold">
              {t(`wizard.${type}Inspection`)}
            </h3>
            <p className="text-sm text-muted-foreground">
              {t('wizard.reservation')} #{reservationNumber}
            </p>
            <p className="text-sm text-muted-foreground">{customerName}</p>
          </div>
        </div>
      </div>

      {/* Quick summary */}
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardContent className="flex items-center gap-4 p-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-950">
              <Package className="h-5 w-5 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <p className="text-2xl font-bold">{itemCount}</p>
              <p className="text-sm text-muted-foreground">
                {t('wizard.itemsToInspect', { count: itemCount })}
              </p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Instructions */}
      <div className="space-y-3">
        <h4 className="text-sm font-medium text-muted-foreground">
          {t('wizard.instructions')}
        </h4>
        <ul className="space-y-2 text-sm">
          <li className="flex items-start gap-2">
            <Check className="mt-0.5 h-4 w-4 text-primary shrink-0" />
            <span>{t(`wizard.instruction1_${type}`)}</span>
          </li>
          <li className="flex items-start gap-2">
            <Check className="mt-0.5 h-4 w-4 text-primary shrink-0" />
            <span>{t('wizard.instruction2')}</span>
          </li>
          <li className="flex items-start gap-2">
            <Check className="mt-0.5 h-4 w-4 text-primary shrink-0" />
            <span>{t('wizard.instruction3')}</span>
          </li>
        </ul>
      </div>

      {/* Quick action */}
      <Button
        variant="outline"
        className="w-full"
        onClick={onAllOk}
      >
        <CheckCircle2 className="mr-2 h-4 w-4" />
        {t('wizard.allItemsOk')}
      </Button>
    </div>
  )
}

interface StepItemsProps {
  items: ReservationItem[]
  inspections: Map<string, ItemInspection>
  currentItemIndex: number
  maxPhotos: number
  onInspectionChange: (itemId: string, data: Partial<ItemInspection>) => void
  onItemIndexChange: (index: number) => void
}

function StepItems({
  items,
  inspections,
  currentItemIndex,
  maxPhotos,
  onInspectionChange,
  onItemIndexChange,
}: StepItemsProps) {
  const t = useTranslations('dashboard.settings.inspection')

  const currentItem = items[currentItemIndex]
  const currentInspection = inspections.get(currentItem.id) || {
    reservationItemId: currentItem.id,
    condition: 'ok' as const,
    notes: '',
    photos: [],
  }

  const handleConditionChange = (condition: 'ok' | 'wear' | 'damage') => {
    onInspectionChange(currentItem.id, { condition })
  }

  const handleNotesChange = (notes: string) => {
    onInspectionChange(currentItem.id, { notes })
  }

  const handlePhotosChange = (photos: CapturedPhoto[]) => {
    onInspectionChange(currentItem.id, { photos })
  }

  return (
    <div className="space-y-6">
      {/* Item progress dots - tap to jump to any item */}
      {items.length > 1 && (
        <div className="flex justify-center gap-1.5">
          {items.map((item, index) => {
            const inspection = inspections.get(item.id)
            const hasIssue = inspection?.condition === 'wear' || inspection?.condition === 'damage'

            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onItemIndexChange(index)}
                className={cn(
                  'h-2 rounded-full transition-all',
                  index === currentItemIndex
                    ? 'w-6 bg-primary'
                    : hasIssue
                      ? 'w-2 bg-amber-500'
                      : inspection
                        ? 'w-2 bg-emerald-500'
                        : 'w-2 bg-muted-foreground/30'
                )}
                aria-label={`${t('table.equipment')} ${index + 1}`}
              />
            )
          })}
        </div>
      )}

      {/* Current item card */}
      <Card>
        <CardHeader className="pb-4">
          <div className="flex items-start gap-4">
            {currentItem.product.images[0] && (
              <div className="h-16 w-16 overflow-hidden rounded-lg bg-muted">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={currentItem.product.images[0]}
                  alt={currentItem.product.name}
                  className="h-full w-full object-cover"
                />
              </div>
            )}
            <div className="flex-1">
              <CardTitle className="text-lg">{currentItem.product.name}</CardTitle>
              <CardDescription>
                {t('wizard.quantity')}: {currentItem.quantity}
              </CardDescription>
            </div>
          </div>
        </CardHeader>

        <CardContent className="space-y-6">
          {/* Condition selector */}
          <div className="space-y-3">
            <Label>{t('wizard.condition')}</Label>
            <QuickConditionSelector
              value={currentInspection.condition}
              onChange={handleConditionChange}
            />
          </div>

          {/* Photos */}
          <div className="space-y-3">
            <Label>{t('wizard.photos')}</Label>
            <PhotoCapture
              photos={currentInspection.photos}
              onPhotosChange={handlePhotosChange}
              maxPhotos={maxPhotos}
            />
          </div>

          {/* Notes (expanded for issues) */}
          {(currentInspection.condition === 'wear' ||
            currentInspection.condition === 'damage') && (
            <div className="space-y-3">
              <Label htmlFor="item-notes">{t('wizard.notes')}</Label>
              <Textarea
                id="item-notes"
                value={currentInspection.notes}
                onChange={(e) => handleNotesChange(e.target.value)}
                placeholder={t('wizard.notesPlaceholder')}
                rows={3}
              />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

interface StepSummaryProps {
  items: ReservationItem[]
  inspections: Map<string, ItemInspection>
  globalNotes: string
  onGlobalNotesChange: (notes: string) => void
}

function StepSummary({
  items,
  inspections,
  globalNotes,
  onGlobalNotesChange,
}: StepSummaryProps) {
  const t = useTranslations('dashboard.settings.inspection')

  const summary = useMemo(() => {
    let ok = 0
    let wear = 0
    let damage = 0

    inspections.forEach((inspection) => {
      switch (inspection.condition) {
        case 'ok':
          ok++
          break
        case 'wear':
          wear++
          break
        case 'damage':
          damage++
          break
      }
    })

    return { ok, wear, damage }
  }, [inspections])

  const hasDamage = summary.damage > 0

  return (
    <div className="space-y-6">
      {/* Summary header */}
      <div
        className={cn(
          'rounded-2xl p-6',
          hasDamage
            ? 'bg-red-50 dark:bg-red-950/30'
            : 'bg-emerald-50 dark:bg-emerald-950/30'
        )}
      >
        <div className="flex items-center gap-4">
          {hasDamage ? (
            <AlertCircle className="h-10 w-10 text-red-600 dark:text-red-400" />
          ) : (
            <CheckCircle2 className="h-10 w-10 text-emerald-600 dark:text-emerald-400" />
          )}
          <div>
            <h3 className="font-semibold">
              {hasDamage ? t('wizard.damageDetected') : t('wizard.allGood')}
            </h3>
            <p className="text-sm text-muted-foreground">
              {t('wizard.summaryItems', { count: items.length })}
            </p>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl border p-3 text-center">
          <p className="text-2xl font-bold text-emerald-600">{summary.ok}</p>
          <p className="text-xs text-muted-foreground">{t('conditions.ok')}</p>
        </div>
        <div className="rounded-xl border p-3 text-center">
          <p className="text-2xl font-bold text-amber-600">{summary.wear}</p>
          <p className="text-xs text-muted-foreground">{t('conditions.wear')}</p>
        </div>
        <div className="rounded-xl border p-3 text-center">
          <p className="text-2xl font-bold text-red-600">{summary.damage}</p>
          <p className="text-xs text-muted-foreground">{t('conditions.damage')}</p>
        </div>
      </div>

      {/* Items with issues */}
      {(summary.wear > 0 || summary.damage > 0) && (
        <div className="space-y-3">
          <h4 className="text-sm font-medium">{t('wizard.itemsWithIssues')}</h4>
          <div className="space-y-2">
            {items.map((item) => {
              const inspection = inspections.get(item.id)
              if (!inspection || inspection.condition === 'ok') return null

              return (
                <div
                  key={item.id}
                  className="flex items-center justify-between rounded-lg border p-3"
                >
                  <div className="flex items-center gap-3">
                    {item.product.images[0] && (
                      <div className="h-10 w-10 overflow-hidden rounded-lg bg-muted">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={item.product.images[0]}
                          alt=""
                          className="h-full w-full object-cover"
                        />
                      </div>
                    )}
                    <span className="text-sm font-medium">{item.product.name}</span>
                  </div>
                  <Badge
                    variant={inspection.condition === 'damage' ? 'destructive' : 'secondary'}
                  >
                    {t(`conditions.${inspection.condition}`)}
                  </Badge>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Global notes */}
      <div className="space-y-3">
        <Label htmlFor="global-notes">{t('wizard.globalNotes')}</Label>
        <Textarea
          id="global-notes"
          value={globalNotes}
          onChange={(e) => onGlobalNotesChange(e.target.value)}
          placeholder={t('wizard.globalNotesPlaceholder')}
          rows={4}
        />
      </div>
    </div>
  )
}

interface StepSignatureProps {
  customerName: string
  signature: string | null
  onSignatureChange: (signature: string | null) => void
}

function StepSignature({
  customerName,
  signature,
  onSignatureChange,
}: StepSignatureProps) {
  const t = useTranslations('dashboard.settings.inspection')

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="rounded-2xl bg-gradient-to-br from-blue-50 via-blue-25 to-transparent p-6 dark:from-blue-950/50 dark:via-blue-950/25">
        <div className="flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-900">
            <PenLine className="h-6 w-6 text-blue-600 dark:text-blue-400" />
          </div>
          <div>
            <h3 className="font-semibold">{t('wizard.signatureTitle')}</h3>
            <p className="text-sm text-muted-foreground">
              {t('wizard.signatureDescription')}
            </p>
          </div>
        </div>
      </div>

      {/* Signature pad */}
      <SignaturePad
        value={signature}
        onChange={onSignatureChange}
        signerName={customerName}
      />
    </div>
  )
}

// ============================================================================
// Main Wizard Component
// ============================================================================

export function InspectionWizard({
  reservationId,
  reservationNumber,
  customerName,
  type,
  items,
  requireSignature,
  maxPhotosPerItem,
  onComplete,
}: InspectionWizardProps) {
  const router = useRouter()
  const t = useTranslations('dashboard.settings.inspection')

  // Wizard state
  const [currentStep, setCurrentStep] = useState<WizardStep>('overview')
  const [currentItemIndex, setCurrentItemIndex] = useState(0)
  const [inspections, setInspections] = useState<Map<string, ItemInspection>>(
    () => {
      const map = new Map<string, ItemInspection>()
      items.forEach((item) => {
        map.set(item.id, {
          reservationItemId: item.id,
          condition: 'ok',
          notes: '',
          photos: [],
        })
      })
      return map
    }
  )
  const [globalNotes, setGlobalNotes] = useState('')
  const [signature, setSignature] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Determine active steps
  const activeSteps = useMemo(() => {
    const steps: WizardStep[] = ['overview', 'items', 'summary']
    if (requireSignature) {
      steps.push('signature')
    }
    return steps
  }, [requireSignature])

  const currentStepIndex = activeSteps.indexOf(currentStep)
  const progress = ((currentStepIndex + 1) / activeSteps.length) * 100

  const canProceed = useMemo(() => {
    switch (currentStep) {
      case 'overview':
        return true
      case 'items':
        // All items must have been viewed
        return true
      case 'summary':
        return true
      case 'signature':
        return !!signature
      default:
        return false
    }
  }, [currentStep, signature])

  const handleInspectionChange = useCallback(
    (itemId: string, data: Partial<ItemInspection>) => {
      setInspections((prev) => {
        const updated = new Map(prev)
        const current = updated.get(itemId) || {
          reservationItemId: itemId,
          condition: 'ok' as const,
          notes: '',
          photos: [],
        }
        updated.set(itemId, { ...current, ...data })
        return updated
      })
    },
    []
  )

  const handleAllOk = useCallback(() => {
    // Mark all items as OK and skip to summary
    const updated = new Map<string, ItemInspection>()
    items.forEach((item) => {
      updated.set(item.id, {
        reservationItemId: item.id,
        condition: 'ok',
        notes: '',
        photos: [],
      })
    })
    setInspections(updated)
    setCurrentStep('summary')
  }, [items])

  const handleNext = useCallback(() => {
    // When on items step, navigate through items first
    if (currentStep === 'items' && currentItemIndex < items.length - 1) {
      setCurrentItemIndex(currentItemIndex + 1)
      return
    }

    // Otherwise go to next step
    const nextIndex = currentStepIndex + 1
    if (nextIndex < activeSteps.length) {
      setCurrentStep(activeSteps[nextIndex])
    }
  }, [currentStep, currentStepIndex, currentItemIndex, items.length, activeSteps])

  const handleBack = useCallback(() => {
    // When on items step, navigate through items first
    if (currentStep === 'items' && currentItemIndex > 0) {
      setCurrentItemIndex(currentItemIndex - 1)
      return
    }

    // Otherwise go to previous step
    const prevIndex = currentStepIndex - 1
    if (prevIndex >= 0) {
      setCurrentStep(activeSteps[prevIndex])
      // If going back to items step, go to the last item
      if (activeSteps[prevIndex] === 'items') {
        setCurrentItemIndex(items.length - 1)
      }
    }
  }, [currentStep, currentStepIndex, currentItemIndex, activeSteps, items.length])

  const handleSubmit = useCallback(async () => {
    setIsSubmitting(true)

    try {
      // Convert inspections to API format
      const itemsData = Array.from(inspections.entries()).map(([, inspection]) => ({
        reservationItemId: inspection.reservationItemId,
        overallCondition: quickToFullCondition(inspection.condition) as ConditionRating,
        notes: inspection.notes || null,
        fieldValues: [],
      }))

      const hasDamage = Array.from(inspections.values()).some(
        (i) => i.condition === 'damage'
      )

      // Import and call server action
      const { createInspection, completeInspection, signInspection } = await import(
        '../../actions'
      )

      // Create inspection
      const createResult = await createInspection({
        reservationId,
        type,
        notes: globalNotes || null,
        items: itemsData,
      })

      if (createResult.error || !createResult.inspectionId) {
        throw new Error(createResult.error || 'Failed to create inspection')
      }

      // Complete inspection
      const completeResult = await completeInspection(createResult.inspectionId, {
        notes: globalNotes || null,
        hasDamage,
        damageDescription: hasDamage
          ? Array.from(inspections.values())
              .filter((i) => i.condition === 'damage')
              .map((i) => i.notes)
              .filter(Boolean)
              .join('; ') || null
          : null,
        estimatedDamageCost: null,
      })

      if (completeResult.error) {
        throw new Error(completeResult.error)
      }

      // Sign if required
      if (requireSignature && signature) {
        const signResult = await signInspection(createResult.inspectionId, {
          customerSignature: signature,
        })

        if (signResult.error) {
          throw new Error(signResult.error)
        }
      }

      toast.success(t('wizard.inspectionComplete'))
      onComplete?.()
      router.push(`/dashboard/reservations/${reservationId}`)
      router.refresh()
    } catch (error) {
      console.error('Inspection error:', error)
      toast.error(t('wizard.inspectionError'))
    } finally {
      setIsSubmitting(false)
    }
  }, [
    inspections,
    reservationId,
    type,
    globalNotes,
    requireSignature,
    signature,
    t,
    onComplete,
    router,
  ])

  const isLastStep = currentStepIndex === activeSteps.length - 1
  const isOnItemsStep = currentStep === 'items'
  const isLastItem = currentItemIndex === items.length - 1
  const isFirstItem = currentItemIndex === 0

  // Determine if back button should be disabled
  // Only disabled on overview step (first step, first item is N/A)
  const isBackDisabled = currentStepIndex === 0 || isSubmitting

  return (
    // Break out of dashboard padding for full-screen experience
    // Mobile: account for MobileHeader (h-14 = 3.5rem)
    // Desktop: full viewport height (sidebar is separate)
    <div className="-mx-4 -mt-6 -mb-6 sm:-mx-6 lg:-mx-8 flex min-h-[calc(100dvh-3.5rem)] flex-col lg:min-h-dvh">
      {/* Header */}
      <div className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="mx-auto max-w-2xl px-4 py-3 sm:px-6 lg:px-8">
          {/* Title row with close button */}
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 shrink-0"
                onClick={() => router.push(`/dashboard/reservations/${reservationId}`)}
              >
                <ArrowLeft className="h-4 w-4" />
                <span className="sr-only">{t('wizard.back')}</span>
              </Button>
              <div>
                <h1 className="text-sm font-semibold">
                  {t(`wizard.${type}Inspection`)}
                </h1>
                <p className="text-xs text-muted-foreground">
                  {t('wizard.reservation')} #{reservationNumber}
                </p>
              </div>
            </div>
            <span className="text-xs text-muted-foreground">
              {currentStepIndex + 1} / {activeSteps.length}
            </span>
          </div>

          {/* Progress bar */}
          <Progress value={progress} className="h-1" />
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-2xl px-4 py-6 sm:px-6 lg:px-8">
          {currentStep === 'overview' && (
            <StepOverview
              type={type}
              reservationNumber={reservationNumber}
              customerName={customerName}
              itemCount={items.length}
              onAllOk={handleAllOk}
            />
          )}

          {currentStep === 'items' && (
            <StepItems
              items={items}
              inspections={inspections}
              currentItemIndex={currentItemIndex}
              maxPhotos={maxPhotosPerItem}
              onInspectionChange={handleInspectionChange}
              onItemIndexChange={setCurrentItemIndex}
            />
          )}

          {currentStep === 'summary' && (
            <StepSummary
              items={items}
              inspections={inspections}
              globalNotes={globalNotes}
              onGlobalNotesChange={setGlobalNotes}
            />
          )}

          {currentStep === 'signature' && (
            <StepSignature
              customerName={customerName}
              signature={signature}
              onSignatureChange={setSignature}
            />
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="sticky bottom-0 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="mx-auto flex max-w-2xl items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
          <Button
            variant="ghost"
            onClick={handleBack}
            disabled={isBackDisabled}
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            {t('wizard.back')}
          </Button>

          {/* Item counter when on items step */}
          {isOnItemsStep && (
            <span className="text-sm text-muted-foreground">
              {currentItemIndex + 1} / {items.length}
            </span>
          )}

          {isLastStep ? (
            <Button
              onClick={handleSubmit}
              disabled={!canProceed || isSubmitting}
            >
              {isSubmitting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <FileCheck className="mr-2 h-4 w-4" />
              )}
              {t('wizard.complete')}
            </Button>
          ) : (
            <Button onClick={handleNext} disabled={!canProceed}>
              {isOnItemsStep && !isLastItem ? t('wizard.next') : t('wizard.continue')}
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
