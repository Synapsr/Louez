'use client'

import { useRouter } from 'next/navigation'
import { useForm, useFieldArray } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useTransition, useState } from 'react'
import { useTranslations } from 'next-intl'
import { format } from 'date-fns'
import { fr } from 'date-fns/locale'
import { Loader2, Plus, Trash2, Calendar, AlertCircle, CalendarX2 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Form,
} from '@/components/ui/form'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  Alert,
  AlertDescription,
} from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { updateBusinessHours } from './actions'
import { businessHoursSchema, defaultBusinessHours, type BusinessHoursInput } from '@/lib/validations/business-hours'
import { generateTimeSlots, DAY_KEYS } from '@/lib/utils/business-hours'
import type { StoreSettings } from '@/types/store'

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

  const form = useForm<BusinessHoursInput>({
    resolver: zodResolver(businessHoursSchema),
    defaultValues: {
      ...businessHours,
      enabled: true, // Always enabled
    },
  })

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: 'closurePeriods',
  })

  const timeSlots = generateTimeSlots('00:00', '23:30', 30)

  const onSubmit = (data: BusinessHoursInput) => {
    startTransition(async () => {
      // Always submit with enabled=true
      const result = await updateBusinessHours({ ...data, enabled: true })
      if (result.error) {
        form.setError('root', { message: result.error })
        return
      }
      router.refresh()
    })
  }

  const addClosurePeriod = (data: {
    name: string
    startDate: string
    endDate: string
    reason?: string
  }) => {
    append({
      id: crypto.randomUUID(),
      ...data,
    })
    setClosureDialogOpen(false)
  }

  return (
    <div className="space-y-6">
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          {form.formState.errors.root && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                {form.formState.errors.root.message}
              </AlertDescription>
            </Alert>
          )}

          {/* Two-column layout on desktop */}
          <div className="grid gap-6 lg:grid-cols-2">
            {/* Weekly Schedule - Left column */}
            <Card>
              <CardHeader>
                <CardTitle>{t('weeklySchedule')}</CardTitle>
                <CardDescription>{t('weeklyScheduleDescription')}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
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
                {fields.length === 0 ? (
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
                    {fields.map((field, index) => (
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
                          onClick={() => remove(index)}
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

          <div className="flex justify-end">
            <Button type="submit" disabled={isPending}>
              {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {tCommon('save')}
            </Button>
          </div>
        </form>
      </Form>
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
  form: ReturnType<typeof useForm<BusinessHoursInput>>
  t: ReturnType<typeof useTranslations>
  timeSlots: string[]
}) {
  const schedule = form.watch('schedule')
  const isOpen = schedule[dayKey]?.isOpen ?? false

  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-3 rounded-lg border p-4">
      <div className="flex items-center gap-3 min-w-[140px]">
        <Switch
          checked={isOpen}
          onCheckedChange={(checked) => {
            form.setValue(`schedule.${dayKey}.isOpen` as any, checked)
          }}
        />
        <span className={`font-medium ${!isOpen ? 'text-muted-foreground' : ''}`}>
          {t(`days.${dayKey}`)}
        </span>
      </div>

      {isOpen ? (
        <div className="flex items-center gap-2 flex-1">
          <Select
            value={schedule[dayKey]?.openTime ?? '09:00'}
            onValueChange={(value) => {
              form.setValue(`schedule.${dayKey}.openTime` as any, value)
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
          <span className="text-muted-foreground">-</span>
          <Select
            value={schedule[dayKey]?.closeTime ?? '18:00'}
            onValueChange={(value) => {
              form.setValue(`schedule.${dayKey}.closeTime` as any, value)
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
      <DialogTrigger asChild>
        <Button type="button" variant="outline" size="sm">
          <Plus className="mr-2 h-4 w-4" />
          {t('addClosure')}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('closureForm.title')}</DialogTitle>
          <DialogDescription>{t('closurePeriodsDescription')}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {error && (
            <Alert variant="destructive">
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
