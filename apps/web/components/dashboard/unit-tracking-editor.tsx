'use client'

import { useState, useMemo, useEffect } from 'react'
import { Plus, Trash2, Package, ChevronDown, AlertCircle, Settings2, StickyNote, Lightbulb } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { Button } from '@louez/ui'
import { Input } from '@louez/ui'
import { Label } from '@louez/ui'
import { Switch } from '@louez/ui'
import { Badge } from '@louez/ui'
import { Textarea } from '@louez/ui'
import { Separator } from '@louez/ui'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@louez/ui'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@louez/ui'
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@louez/ui'
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
  DialogTrigger,
} from '@louez/ui'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@louez/ui'
import { buildPartialCombinationKey, cn, normalizeAxisKey } from '@louez/utils'

type UnitStatus = 'available' | 'maintenance' | 'retired'

interface ProductUnitInput {
  id?: string
  identifier: string
  notes?: string
  status?: UnitStatus
  attributes?: Record<string, string>
}

interface BookingAttributeAxisInput {
  key: string
  label: string
  position: number
}

function AttributeValueCombobox({
  value,
  onChange,
  suggestions,
  placeholder,
  disabled,
  hasError,
  createHint,
}: {
  value: string
  onChange: (value: string) => void
  suggestions: string[]
  placeholder: string
  disabled: boolean
  hasError: boolean
  createHint: (value: string) => string
}) {
  const [localValue, setLocalValue] = useState(value)
  const [open, setOpen] = useState(false)

  // Sync from parent when value changes externally
  useEffect(() => {
    setLocalValue(value)
  }, [value])

  const filtered = useMemo(() => {
    if (!localValue.trim()) return suggestions
    const lower = localValue.toLowerCase()
    return suggestions.filter((s) => s.toLowerCase().includes(lower))
  }, [suggestions, localValue])

  const trimmed = localValue.trim()
  const isNewValue =
    trimmed.length > 0 &&
    !suggestions.some((s) => s.toLowerCase() === trimmed.toLowerCase())

  return (
    <div className="relative">
      <Input
        value={localValue}
        onChange={(e) => setLocalValue(e.target.value)}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          setTimeout(() => setOpen(false), 150)
          if (localValue !== value) onChange(localValue)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            onChange(localValue)
            setOpen(false)
            ;(e.target as HTMLInputElement).blur()
          }
        }}
        placeholder={placeholder}
        disabled={disabled}
        className={cn(hasError && !localValue.trim() && 'border-destructive/60')}
      />
      {open && (filtered.length > 0 || isNewValue) && (
        <div className="absolute z-50 mt-1 max-h-[200px] w-full overflow-y-auto rounded-lg border bg-popover p-1 shadow-lg">
          {filtered.map((s) => (
            <button
              key={s}
              type="button"
              className={cn(
                'w-full cursor-default rounded-sm px-2 py-1.5 text-left text-sm outline-none hover:bg-accent hover:text-accent-foreground',
                s === localValue && 'bg-accent/50 font-medium',
              )}
              onMouseDown={(e) => {
                e.preventDefault()
                setLocalValue(s)
                onChange(s)
                setOpen(false)
              }}
            >
              {s}
            </button>
          ))}
          {isNewValue && (
            <p className="px-2 py-1.5 text-xs text-muted-foreground">
              {createHint(trimmed)}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function BookingAttributesDialog({
  axes,
  onAddAxis,
  onRemoveAxis,
  disabled,
}: {
  axes: BookingAttributeAxisInput[]
  onAddAxis: (label: string) => void
  onRemoveAxis: (key: string) => void
  disabled: boolean
}) {
  const t = useTranslations('dashboard.products.form.unitTracking')
  const [newAxisLabel, setNewAxisLabel] = useState('')

  const handleAdd = () => {
    const label = newAxisLabel.trim()
    if (!label) return
    onAddAxis(label)
    setNewAxisLabel('')
  }

  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button type="button" variant="outline" size="sm" disabled={disabled} />
        }
      >
        <Settings2 className="h-4 w-4" />
        {t('manageAttributes')}
        {axes.length > 0 && (
          <Badge variant="secondary" className="ml-1">
            {axes.length}/3
          </Badge>
        )}
      </DialogTrigger>
      <DialogPopup className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('bookingAttributesTitle')}</DialogTitle>
          <DialogDescription>{t('manageAttributesDescription')}</DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <div className="space-y-4">
            <div className="rounded-lg border border-blue-200 bg-blue-50/50 p-3 dark:border-blue-900 dark:bg-blue-950/30">
              <div className="flex gap-2">
                <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />
                <div className="space-y-1">
                  <p className="text-xs text-blue-800 dark:text-blue-300">
                    {t('manageAttributesExample')}
                  </p>
                  <p className="text-xs font-medium text-blue-600 dark:text-blue-400">
                    {t('manageAttributesMax')}
                  </p>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Input
                value={newAxisLabel}
                onChange={(e) => setNewAxisLabel(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    handleAdd()
                  }
                }}
                placeholder={t('bookingAttributePlaceholder')}
                disabled={disabled || axes.length >= 3}
                className="flex-1"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleAdd}
                disabled={disabled || !newAxisLabel.trim() || axes.length >= 3}
              >
                <Plus className="h-3.5 w-3.5" />
                {t('addAttribute')}
              </Button>
            </div>

            {axes.length > 0 ? (
              <div className="space-y-2">
                {axes.map((axis) => (
                  <div
                    key={axis.key}
                    className="flex items-center justify-between rounded-lg border px-3 py-2"
                  >
                    <div className="flex items-center gap-2">
                      <span className="flex h-5 w-5 items-center justify-center rounded-md bg-muted text-xs font-medium">
                        {axis.position + 1}
                      </span>
                      <span className="text-sm font-medium">{axis.label}</span>
                      <span className="font-mono text-xs text-muted-foreground">
                        {axis.key}
                      </span>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive"
                      onClick={() => onRemoveAxis(axis.key)}
                      disabled={disabled}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed p-4 text-center">
                <p className="text-sm text-muted-foreground">
                  {t('bookingAttributesEmpty')}
                </p>
              </div>
            )}
          </div>
        </DialogPanel>
        <DialogFooter variant="bare">
          <DialogClose render={<Button variant="outline" />}>
            {t('confirm')}
          </DialogClose>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  )
}

const STATUS_COLORS: Record<UnitStatus, string> = {
  available: 'bg-green-500',
  maintenance: 'bg-amber-500',
  retired: 'bg-gray-400',
}

function UnitRow({
  unit,
  index,
  bookingAttributeAxes,
  existingValuesByAxis,
  isDuplicate,
  isEmpty,
  disabled,
  onUpdate,
  onUpdateAttribute,
  onRemove,
  onTouch,
}: {
  unit: ProductUnitInput
  index: number
  bookingAttributeAxes: BookingAttributeAxisInput[]
  existingValuesByAxis: Record<string, string[]>
  isDuplicate: boolean
  isEmpty: boolean
  disabled: boolean
  onUpdate: (index: number, patch: Partial<ProductUnitInput>) => void
  onUpdateAttribute: (index: number, axisKey: string, value: string) => void
  onRemove: (index: number) => void
  onTouch: (index: number) => void
}) {
  const t = useTranslations('dashboard.products.form.unitTracking')
  const [isEditingNotes, setIsEditingNotes] = useState(false)
  const hasAxes = bookingAttributeAxes.length > 0
  const status = unit.status || 'available'

  const hasAnyAttributeValue = hasAxes && bookingAttributeAxes.some(
    (axis) => !!unit.attributes?.[axis.key]?.trim(),
  )
  const combinationLabel = hasAnyAttributeValue
    ? buildPartialCombinationKey(bookingAttributeAxes, unit.attributes)
    : null

  return (
    <div
      className={cn(
        'rounded-lg border p-3 transition-colors',
        isDuplicate && 'border-destructive bg-destructive/5',
      )}
    >
      {/* Row 1: status dot + identifier + status select + delete */}
      <div className="flex items-center gap-2">
        <span
          className={cn('h-2 w-2 shrink-0 rounded-full', STATUS_COLORS[status])}
        />
        <Input
          placeholder={t('identifierPlaceholder')}
          value={unit.identifier}
          onChange={(e) => onUpdate(index, { identifier: e.target.value })}
          onBlur={() => onTouch(index)}
          className={cn('flex-1', (isDuplicate || isEmpty) && 'border-destructive')}
          disabled={disabled}
        />
        <Select
          value={status}
          onValueChange={(value) => {
            if (value !== null) onUpdate(index, { status: value as UnitStatus })
          }}
          disabled={disabled}
        >
          <SelectTrigger className="w-[140px]">
            <SelectValue>
              {
                ({
                  available: t('statusAvailable'),
                  maintenance: t('statusMaintenance'),
                  retired: t('statusRetired'),
                } as const)[status]
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="available" label={t('statusAvailable')}>
              <span className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-green-500" />
                {t('statusAvailable')}
              </span>
            </SelectItem>
            <SelectItem value="maintenance" label={t('statusMaintenance')}>
              <span className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-amber-500" />
                {t('statusMaintenance')}
              </span>
            </SelectItem>
            <SelectItem value="retired" label={t('statusRetired')}>
              <span className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-gray-400" />
                {t('statusRetired')}
              </span>
            </SelectItem>
          </SelectContent>
        </Select>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => onRemove(index)}
                  disabled={disabled}
                  className="shrink-0 text-muted-foreground hover:text-destructive"
                />
              }
            >
              <Trash2 className="h-4 w-4" />
            </TooltipTrigger>
            <TooltipContent>
              <p>{t('deleteConfirm')}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      {isEmpty && (
        <p className="mt-1.5 text-xs text-destructive">{t('identifierRequired')}</p>
      )}

      {/* Row 2: attribute values (only when axes exist) */}
      {hasAxes && (
        <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {bookingAttributeAxes.map((axis) => {
            const suggestions = existingValuesByAxis[axis.key] || []
            const currentValue = unit.attributes?.[axis.key] || ''
            const hasError = !currentValue.trim() && status === 'available'

            return (
              <div key={axis.key} className="space-y-1">
                <Label className="text-xs text-muted-foreground">{axis.label}</Label>
                <AttributeValueCombobox
                  value={currentValue}
                  onChange={(val) => onUpdateAttribute(index, axis.key, val)}
                  suggestions={suggestions}
                  placeholder={t('bookingAttributeValuePlaceholder', {
                    label: axis.label,
                  })}
                  disabled={disabled}
                  hasError={hasError}
                  createHint={(v) => t('pressEnterToCreate', { value: v })}
                />
              </div>
            )
          })}
        </div>
      )}

      {/* Row 3: combination key (only when axes exist and has partial key) */}
      {hasAxes && combinationLabel && (
        <div className="mt-2 flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{t('combinationKey')}:</span>
          <Badge variant="outline" className="font-mono text-[11px]">
            {combinationLabel}
          </Badge>
        </div>
      )}

      {/* Row 4: notes */}
      {isEditingNotes || unit.notes ? (
        <Textarea
          placeholder={t('notesPlaceholder')}
          value={unit.notes || ''}
          onChange={(e) => onUpdate(index, { notes: e.target.value })}
          className="mt-2 min-h-[60px] text-sm"
          disabled={disabled}
          onBlur={() => {
            if (!unit.notes?.trim()) setIsEditingNotes(false)
          }}
        />
      ) : (
        <button
          type="button"
          className="mt-2 flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
          onClick={() => setIsEditingNotes(true)}
          disabled={disabled}
        >
          <StickyNote className="h-3 w-3" />
          {t('addNotes')}
        </button>
      )}
    </div>
  )
}

interface UnitTrackingEditorProps {
  trackUnits: boolean
  onTrackUnitsChange: (value: boolean) => void
  bookingAttributeAxes: BookingAttributeAxisInput[]
  onBookingAttributeAxesChange: (axes: BookingAttributeAxisInput[]) => void
  units: ProductUnitInput[]
  onChange: (units: ProductUnitInput[]) => void
  quantity: string
  onQuantityChange: (value: string) => void
  disabled?: boolean
  showValidationErrors?: boolean
}

export function UnitTrackingEditor({
  trackUnits,
  onTrackUnitsChange,
  bookingAttributeAxes,
  onBookingAttributeAxesChange,
  units,
  onChange,
  quantity,
  onQuantityChange,
  disabled = false,
  showValidationErrors = false,
}: UnitTrackingEditorProps) {
  const t = useTranslations('dashboard.products.form.unitTracking')
  const [showDisableConfirm, setShowDisableConfirm] = useState(false)
  const [bulkOpen, setBulkOpen] = useState(false)
  const [bulkPrefix, setBulkPrefix] = useState('')
  const [bulkFrom, setBulkFrom] = useState('1')
  const [bulkTo, setBulkTo] = useState('5')
  const [touchedUnits, setTouchedUnits] = useState<Set<number>>(new Set())

  const activeUnitsCount = useMemo(() => {
    return units.filter((u) => !u.status || u.status === 'available').length
  }, [units])

  const duplicateIdentifiers = useMemo(() => {
    const seen = new Set<string>()
    const duplicates = new Set<string>()
    for (const unit of units) {
      const normalized = unit.identifier.trim().toLowerCase()
      if (normalized && seen.has(normalized)) {
        duplicates.add(normalized)
      }
      seen.add(normalized)
    }
    return duplicates
  }, [units])

  const existingValuesByAxis = useMemo(() => {
    const map: Record<string, string[]> = {}
    for (const axis of bookingAttributeAxes) {
      const uniqueValues = new Set<string>()
      for (const unit of units) {
        const val = unit.attributes?.[axis.key]?.trim()
        if (val) uniqueValues.add(val)
      }
      map[axis.key] = Array.from(uniqueValues).sort()
    }
    return map
  }, [bookingAttributeAxes, units])

  const missingAttributeCount = useMemo(() => {
    if (bookingAttributeAxes.length === 0) return 0
    return units.filter((unit) => {
      const status = unit.status || 'available'
      if (status !== 'available') return false
      return bookingAttributeAxes.some((axis) => !unit.attributes?.[axis.key]?.trim())
    }).length
  }, [bookingAttributeAxes, units])

  const handleToggle = (enabled: boolean) => {
    if (!enabled && units.length > 0) {
      setShowDisableConfirm(true)
    } else {
      onTrackUnitsChange(enabled)
      if (enabled && units.length === 0) {
        const qty = parseInt(quantity, 10) || 0
        if (qty > 0) {
          const emptyUnits: ProductUnitInput[] = Array.from({ length: qty }, () => ({
            identifier: '',
            notes: '',
            status: 'available',
            attributes: {},
          }))
          onChange(emptyUnits)
        }
      }
    }
  }

  const confirmDisable = () => {
    onTrackUnitsChange(false)
    onBookingAttributeAxesChange([])
    onChange([])
    setShowDisableConfirm(false)
  }

  const addUnit = () => {
    onChange([...units, { identifier: '', notes: '', status: 'available', attributes: {} }])
  }

  const removeUnit = (index: number) => {
    onChange(units.filter((_, i) => i !== index))
  }

  const updateUnit = (index: number, patch: Partial<ProductUnitInput>) => {
    const newUnits = [...units]
    newUnits[index] = { ...newUnits[index], ...patch }
    onChange(newUnits)
  }

  const updateUnitAttribute = (index: number, axisKey: string, value: string) => {
    const newUnits = [...units]
    const currentAttributes = newUnits[index].attributes || {}
    newUnits[index] = {
      ...newUnits[index],
      attributes: {
        ...currentAttributes,
        [axisKey]: value,
      },
    }
    onChange(newUnits)
  }

  const addBookingAxis = (label: string) => {
    const trimmed = label.trim()
    if (!trimmed) return
    const key = normalizeAxisKey(trimmed)
    if (!key) return
    if (bookingAttributeAxes.some((axis) => axis.key === key)) return
    if (bookingAttributeAxes.length >= 3) return

    onBookingAttributeAxesChange([
      ...bookingAttributeAxes,
      { key, label: trimmed, position: bookingAttributeAxes.length },
    ])
  }

  const removeBookingAxis = (key: string) => {
    const nextAxes = bookingAttributeAxes
      .filter((axis) => axis.key !== key)
      .map((axis, index) => ({ ...axis, position: index }))
    onBookingAttributeAxesChange(nextAxes)

    if (units.length > 0) {
      const nextUnits = units.map((unit) => {
        const attributes = { ...(unit.attributes || {}) }
        delete attributes[key]
        return { ...unit, attributes }
      })
      onChange(nextUnits)
    }
  }

  const handleBulkGenerate = () => {
    const from = parseInt(bulkFrom, 10)
    const to = parseInt(bulkTo, 10)
    if (isNaN(from) || isNaN(to) || from > to || to - from > 100) return

    const newUnits: ProductUnitInput[] = []
    for (let i = from; i <= to; i++) {
      const paddedNumber = String(i).padStart(String(to).length, '0')
      const identifier = `${bulkPrefix}${paddedNumber}`
      if (!units.some((u) => u.identifier.toLowerCase() === identifier.toLowerCase())) {
        newUnits.push({ identifier, notes: '', status: 'available', attributes: {} })
      }
    }

    if (newUnits.length > 0) {
      onChange([...units, ...newUnits])
    }

    setBulkPrefix('')
    setBulkFrom('1')
    setBulkTo('5')
    setBulkOpen(false)
  }

  return (
    <div className="space-y-4">
      {/* Quantity field (only shown when tracking is disabled) */}
      {!trackUnits && (
        <div className="grid gap-2">
          <Label htmlFor="quantity">{t('quantityLabel')}</Label>
          <Input
            id="quantity"
            type="number"
            min="1"
            className="w-32"
            value={quantity}
            onChange={(e) => onQuantityChange(e.target.value)}
            disabled={disabled}
          />
        </div>
      )}

      {/* Toggle */}
      <div className="flex items-center justify-between rounded-lg border p-4">
        <div className="space-y-0.5">
          <Label htmlFor="unit-tracking-toggle" className="text-base font-medium">
            {t('toggle')}
          </Label>
          <p className="text-sm text-muted-foreground">{t('toggleDescription')}</p>
        </div>
        <Switch
          id="unit-tracking-toggle"
          checked={trackUnits}
          onCheckedChange={handleToggle}
          disabled={disabled}
        />
      </div>

      {trackUnits && (
        <>
          {/* Active units count */}
          <div className="flex items-center justify-between rounded-lg bg-muted/50 p-3">
            <div className="flex items-center gap-2 text-sm">
              <Package className="h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground">{t('quantityManagedByTracking')}</span>
            </div>
            <span className="font-medium">
              {t('activeUnits', { count: activeUnitsCount })}
            </span>
          </div>

          {/* Unit list section */}
          <div className="space-y-3">
            {/* Header: title + action buttons */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="font-medium">{t('title')}</span>
                <Badge variant="outline">{units.length}</Badge>
              </div>
              <div className="flex items-center gap-2">
                <BookingAttributesDialog
                  axes={bookingAttributeAxes}
                  onAddAxis={addBookingAxis}
                  onRemoveAxis={removeBookingAxis}
                  disabled={disabled}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addUnit}
                  disabled={disabled}
                >
                  <Plus className="h-4 w-4" />
                  {t('addUnit')}
                </Button>
              </div>
            </div>

            {/* Attribute axes summary (read-only badges) */}
            {bookingAttributeAxes.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-muted-foreground">
                  {t('bookingAttributesTitle')}:
                </span>
                {bookingAttributeAxes.map((axis) => (
                  <Badge key={axis.key} variant="secondary" className="gap-1 pr-1">
                    {axis.label}
                    <button
                      type="button"
                      className="rounded-sm px-0.5 hover:bg-black/10 dark:hover:bg-white/10"
                      onClick={() => removeBookingAxis(axis.key)}
                      disabled={disabled}
                    >
                      &times;
                    </button>
                  </Badge>
                ))}
              </div>
            )}

            {/* Unit rows or empty state */}
            {units.length === 0 ? (
              <div className="rounded-lg border border-dashed p-8 text-center">
                <Package className="mx-auto h-10 w-10 text-muted-foreground/40" />
                <p className="mt-3 text-sm font-medium">{t('noUnitsRegistered')}</p>
                <p className="mt-1 text-xs text-muted-foreground">{t('noUnitsHint')}</p>
                <Button
                  type="button"
                  variant="outline"
                  onClick={addUnit}
                  className="mt-4"
                  disabled={disabled}
                >
                  <Plus className="mr-2 h-4 w-4" />
                  {t('addUnit')}
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                {units.map((unit, index) => {
                  const isDuplicate =
                    unit.identifier.trim() &&
                    duplicateIdentifiers.has(unit.identifier.trim().toLowerCase())
                  const isEmpty =
                    (touchedUnits.has(index) || showValidationErrors) &&
                    !unit.identifier.trim()

                  return (
                    <UnitRow
                      key={unit.id || `new-${index}`}
                      unit={unit}
                      index={index}
                      bookingAttributeAxes={bookingAttributeAxes}
                      existingValuesByAxis={existingValuesByAxis}
                      isDuplicate={!!isDuplicate}
                      isEmpty={isEmpty}
                      disabled={disabled}
                      onUpdate={updateUnit}
                      onUpdateAttribute={updateUnitAttribute}
                      onRemove={removeUnit}
                      onTouch={(i) => setTouchedUnits((prev) => new Set(prev).add(i))}
                    />
                  )
                })}
              </div>
            )}

            {/* Warnings */}
            {duplicateIdentifiers.size > 0 && (
              <div className="flex items-center gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{t('duplicateIdentifier')}</span>
              </div>
            )}

            {missingAttributeCount > 0 && (
              <div className="flex items-center gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{t('missingAttributesWarning', { count: missingAttributeCount })}</span>
              </div>
            )}

            <Separator />

            {/* Bulk add */}
            <Collapsible open={bulkOpen} onOpenChange={setBulkOpen}>
              <CollapsibleTrigger
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    className="w-full justify-between"
                    disabled={disabled}
                  />
                }
              >
                {t('bulkAdd')}
                <ChevronDown
                  className={cn(
                    'h-4 w-4 transition-transform',
                    bulkOpen && 'rotate-180',
                  )}
                />
              </CollapsibleTrigger>
              <CollapsibleContent className="pt-3">
                <div className="rounded-lg border bg-muted/40 p-4">
                  <div className="grid gap-4 sm:grid-cols-4">
                    <div className="space-y-2">
                      <Label className="text-xs">{t('bulkPrefix')}</Label>
                      <Input
                        placeholder={t('bulkPrefixPlaceholder')}
                        value={bulkPrefix}
                        onChange={(e) => setBulkPrefix(e.target.value)}
                        disabled={disabled}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs">{t('bulkFrom')}</Label>
                      <Input
                        type="number"
                        min="1"
                        value={bulkFrom}
                        onChange={(e) => setBulkFrom(e.target.value)}
                        disabled={disabled}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label className="text-xs">{t('bulkTo')}</Label>
                      <Input
                        type="number"
                        min="1"
                        value={bulkTo}
                        onChange={(e) => setBulkTo(e.target.value)}
                        disabled={disabled}
                      />
                    </div>
                    <div className="flex items-end">
                      <Button
                        type="button"
                        onClick={handleBulkGenerate}
                        disabled={disabled || !bulkPrefix.trim()}
                        className="w-full"
                      >
                        {t('bulkGenerate')}
                      </Button>
                    </div>
                  </div>
                  <p className="mt-3 text-xs text-muted-foreground">
                    {bulkPrefix && (
                      <>
                        {t('bulkPreview')}: {bulkPrefix}
                        {String(parseInt(bulkFrom, 10) || 1).padStart(
                          String(parseInt(bulkTo, 10) || 5).length,
                          '0',
                        )}{' '}
                        ... {bulkPrefix}
                        {bulkTo}
                      </>
                    )}
                  </p>
                </div>
              </CollapsibleContent>
            </Collapsible>
          </div>
        </>
      )}

      {/* Disable confirmation dialog */}
      <AlertDialog open={showDisableConfirm} onOpenChange={setShowDisableConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('disableConfirm')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('disableDescription', { count: activeUnitsCount })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>
              {t('cancel')}
            </AlertDialogClose>
            <AlertDialogClose render={<Button />} onClick={confirmDisable}>
              {t('confirm')}
            </AlertDialogClose>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
