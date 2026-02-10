'use client'

import { useRouter } from 'next/navigation'
import { useTransition, useState, useCallback } from 'react'
import { useTranslations } from 'next-intl'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'
import { Plus, Trash2, Calendar, AlertCircle, CalendarX2 } from 'lucide-react'
import { toastManager } from '@louez/ui'
import { useStore } from '@tanstack/react-form'

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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@louez/ui'
import { Switch } from '@louez/ui'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@louez/ui'
import {
  Alert,
  AlertDescription,
} from '@louez/ui'
import { Badge } from '@louez/ui'
import { Textarea } from '@louez/ui'
import { Label } from '@louez/ui'
import { updateBusinessHours } from './actions'
import { FloatingSaveBar } from '@/components/dashboard/floating-save-bar'
import { RootError } from '@/components/form/root-error'
import { businessHoursSchema, defaultBusinessHours, type BusinessHoursInput } from '@louez/validations'
import { generateTimeSlots, DAY_KEYS } from '@/lib/utils/business-hours'
import type { StoreSettings } from '@louez/types'
import { useAppForm } from '@/hooks/form/form'

interface Store {
  id: string
  settings: StoreSettings | null
}

interface BusinessHoursFormProps {
  store: Store
}

export function BusinessHoursForm({ store }: BusinessHoursFormProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [closureDialogOpen, setClosureDialogOpen] = useState(false)
  const t = useTranslations('dashboard.settings.businessHours')
  const tCommon = useTranslations('common')

  const businessHours = store.settings?.businessHours || defaultBusinessHours

  const [rootError, setRootError] = useState<string | null>(null)
  const form = useAppForm({
    defaultValues: businessHours,
    validators: { onSubmit: businessHoursSchema },
    onSubmit: async ({ value }) => {
      setRootError(null)
      startTransition(async () => {
        const result = await updateBusinessHours(value)
        if (result.error) {
          setRootError(result.error)
          return
        }
        toastManager.add({ title: t('saved'), type: 'success' })
        router.refresh()
      })
    },
  })

  const isDirty = useStore(form.store, (s) => s.isDirty)

  const handleReset = useCallback(() => {
    form.reset()
  }, [form])

  const isEnabled = useStore(form.store, (s) => s.values.enabled)

  const timeSlots = generateTimeSlots('00:00', '23:30', 30)

  const addClosurePeriod = (data: {
    name: string
    startDate: string
    endDate: string
    reason?: string
  }) => {
    form.pushFieldValue('closurePeriods', {
      id: crypto.randomUUID(),
      ...data,
    })
    setClosureDialogOpen(false)
  }

  const removeClosurePeriod = (index: number) => {
    form.removeFieldValue('closurePeriods', index)
  }

  const closurePeriods = useStore(form.store, (s) => s.values.closurePeriods)

  return (
    <div className="space-y-6">
      <form onSubmit={(e) => { e.preventDefault(); e.stopPropagation(); form.handleSubmit() }} className="space-y-6">
        <RootError error={rootError} />

        {/* Two-column layout on desktop */}
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Weekly Schedule - Left column */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>{t('weeklySchedule')}</CardTitle>
                  <CardDescription>{t('weeklyScheduleDescription')}</CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">
                    {isEnabled ? t('enabled') : t('disabled')}
                  </span>
                  <form.Field name="enabled">
                    {(field) => (
                      <Switch
                        checked={field.state.value}
                        onCheckedChange={(checked) => field.handleChange(checked)}
                      />
                    )}
                  </form.Field>
                </div>
              </div>
            </CardHeader>
            <CardContent className={`space-y-3 ${!isEnabled ? 'opacity-50 pointer-events-none' : ''}`}>
              {DAY_KEYS.map((dayKey) => (
                <DayScheduleRow
                  key={dayKey}
                  dayKey={dayKey}
                  form={form}
                  t={t}
                  timeSlots={timeSlots}
                />
              ))}
            </CardContent>
          </Card>

          {/* Closure Periods - Right column */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>{t('closurePeriods')}</CardTitle>
                  <CardDescription>{t('closurePeriodsDescription')}</CardDescription>
                </div>
                <ClosurePeriodDialog
                  open={closureDialogOpen}
                  onOpenChange={setClosureDialogOpen}
                  onAdd={addClosurePeriod}
                  t={t}
                  tCommon={tCommon}
                />
              </div>
            </CardHeader>
            <CardContent>
              {closurePeriods.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <div className="rounded-full bg-muted p-3 mb-4">
                    <CalendarX2 className="h-6 w-6 text-muted-foreground" />
                  </div>
                  <p className="text-sm font-medium text-muted-foreground">
                    {t('noClosure')}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1 max-w-[200px]">
                    {t('noClosureDescription')}
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {closurePeriods.map((field, index) => (
                    <div
                      key={field.id}
                      className="flex items-center justify-between rounded-lg border p-3"
                    >
                      <div className="space-y-1 min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <Calendar className="h-4 w-4 text-muted-foreground shrink-0" />
                          <span className="font-medium truncate">{field.name}</span>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {format(new Date(field.startDate), 'dd MMM yyyy', { locale: fr })}
                          {' - '}
                          {format(new Date(field.endDate), 'dd MMM yyyy', { locale: fr })}
                        </p>
                        {field.reason && (
                          <p className="text-xs text-muted-foreground truncate">{field.reason}</p>
                        )}
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="shrink-0"
                        onClick={() => removeClosurePeriod(index)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <FloatingSaveBar
          isDirty={isDirty}
          isLoading={isPending}
          onReset={handleReset}
        />
      </form>
    </div>
  )
}

// Day Schedule Row Component
function DayScheduleRow({
  dayKey,
  form,
  t,
  timeSlots,
}: {
  dayKey: 0 | 1 | 2 | 3 | 4 | 5 | 6
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  form: any
  t: ReturnType<typeof useTranslations>
  timeSlots: string[]
}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const schedule = useStore(form.store, (s: any) => s.values.schedule)
  const isOpen = schedule[dayKey]?.isOpen ?? false

  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-3 rounded-lg border p-4">
      <div className="flex items-center gap-3 min-w-[140px]">
        <form.Field name={`schedule.${dayKey}.isOpen` as any}>
          {(field: any) => (
            <Switch
              checked={field.state.value}
              onCheckedChange={(checked) => field.handleChange(checked)}
            />
          )}
        </form.Field>
        <span className={`font-medium ${!isOpen ? 'text-muted-foreground' : ''}`}>
          {t(`days.${dayKey}`)}
        </span>
      </div>

      {isOpen ? (
        <div className="flex items-center gap-2 flex-1">
          <form.Field name={`schedule.${dayKey}.openTime` as any}>
            {(field: any) => (
              <Select
                value={field.state.value}
                onValueChange={(value) => {
                  if (value !== null) field.handleChange(value)
                }}
              >
                <SelectTrigger className="flex-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {timeSlots.map((time) => (
                    <SelectItem key={time} value={time}>
                      {time}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </form.Field>
          <span className="text-muted-foreground">-</span>
          <form.Field name={`schedule.${dayKey}.closeTime` as any}>
            {(field: any) => (
              <Select
                value={field.state.value}
                onValueChange={(value) => {
                  if (value !== null) field.handleChange(value)
                }}
              >
                <SelectTrigger className="flex-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {timeSlots.map((time) => (
                    <SelectItem key={time} value={time}>
                      {time}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </form.Field>
        </div>
      ) : (
        <Badge variant="secondary" className="text-muted-foreground">
          {t('closed')}
        </Badge>
      )}
    </div>
  )
}

// Closure Period Dialog Component
function ClosurePeriodDialog({
  open,
  onOpenChange,
  onAdd,
  t,
  tCommon,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onAdd: (data: { name: string; startDate: string; endDate: string; reason?: string }) => void
  t: ReturnType<typeof useTranslations>
  tCommon: ReturnType<typeof useTranslations>
}) {
  const tValidation = useTranslations('validation')
  const [name, setName] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [reason, setReason] = useState('')
  const [error, setError] = useState('')

  const handleSubmit = () => {
    if (!name || !startDate || !endDate) {
      setError(tValidation('requiredFields'))
      return
    }

    if (new Date(startDate) > new Date(endDate)) {
      setError(tValidation('endDateBeforeStart'))
      return
    }

    onAdd({
      name,
      startDate,
      endDate,
      reason: reason || undefined,
    })

    // Reset form
    setName('')
    setStartDate('')
    setEndDate('')
    setReason('')
    setError('')
  }

  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) {
      // Reset form on close
      setName('')
      setStartDate('')
      setEndDate('')
      setReason('')
      setError('')
    }
    onOpenChange(isOpen)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={<Button type="button" variant="outline" />}>
        <Plus className="mr-2 h-4 w-4" />
        {t('addClosure')}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('closureForm.title')}</DialogTitle>
          <DialogDescription>{t('closurePeriodsDescription')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {error && (
            <Alert variant="error">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <div className="space-y-2">
            <label className="text-sm font-medium">{t('closureForm.name')} *</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('closureForm.namePlaceholder')}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">{t('closureForm.startDate')} *</label>
              <Input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">{t('closureForm.endDate')} *</label>
              <Input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">{t('closureForm.reason')}</label>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t('closureForm.reasonPlaceholder')}
              rows={2}
            />
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
            {tCommon('cancel')}
          </Button>
          <Button type="button" onClick={handleSubmit}>
            {t('closureForm.add')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
