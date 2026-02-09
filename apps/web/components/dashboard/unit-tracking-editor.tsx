'use client'

import { useState, useMemo } from 'react'
import { Plus, Trash2, Package, ChevronDown, AlertCircle } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { Button } from '@louez/ui'
import { Input } from '@louez/ui'
import { Label } from '@louez/ui'
import { Switch } from '@louez/ui'
import { Badge } from '@louez/ui'
import { Textarea } from '@louez/ui'
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
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@louez/ui'
import { cn } from '@louez/utils'

type UnitStatus = 'available' | 'maintenance' | 'retired'

interface ProductUnitInput {
  id?: string
  identifier: string
  notes?: string
  status?: UnitStatus
}

interface UnitTrackingEditorProps {
  trackUnits: boolean
  onTrackUnitsChange: (value: boolean) => void
  units: ProductUnitInput[]
  onChange: (units: ProductUnitInput[]) => void
  quantity: string
  onQuantityChange: (value: string) => void
  disabled?: boolean
}

export function UnitTrackingEditor({
  trackUnits,
  onTrackUnitsChange,
  units,
  onChange,
  quantity,
  onQuantityChange,
  disabled = false,
}: UnitTrackingEditorProps) {
  const t = useTranslations('dashboard.products.form.unitTracking')
  const [showDisableConfirm, setShowDisableConfirm] = useState(false)
  const [bulkOpen, setBulkOpen] = useState(false)
  const [bulkPrefix, setBulkPrefix] = useState('')
  const [bulkFrom, setBulkFrom] = useState('1')
  const [bulkTo, setBulkTo] = useState('5')
  const [editingNotes, setEditingNotes] = useState<Record<number, boolean>>({})
  const [touchedUnits, setTouchedUnits] = useState<Set<number>>(new Set())

  // Calculate active units count (available status only)
  const activeUnitsCount = useMemo(() => {
    return units.filter((u) => !u.status || u.status === 'available').length
  }, [units])

  // Check for duplicate identifiers
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

  const handleToggle = (enabled: boolean) => {
    if (!enabled && units.length > 0) {
      setShowDisableConfirm(true)
    } else {
      onTrackUnitsChange(enabled)
      // Pre-create empty slots based on current quantity when enabling
      if (enabled && units.length === 0) {
        const qty = parseInt(quantity, 10) || 0
        if (qty > 0) {
          const emptyUnits: ProductUnitInput[] = Array.from({ length: qty }, () => ({
            identifier: '',
            notes: '',
            status: 'available',
          }))
          onChange(emptyUnits)
        }
      }
    }
  }

  const confirmDisable = () => {
    onTrackUnitsChange(false)
    onChange([])
    setShowDisableConfirm(false)
  }

  const addUnit = () => {
    onChange([...units, { identifier: '', notes: '', status: 'available' }])
  }

  const removeUnit = (index: number) => {
    onChange(units.filter((_, i) => i !== index))
  }

  const updateUnit = (index: number, field: keyof ProductUnitInput, value: string) => {
    const newUnits = [...units]
    newUnits[index] = { ...newUnits[index], [field]: value }
    onChange(newUnits)
  }

  const handleBulkGenerate = () => {
    const from = parseInt(bulkFrom, 10)
    const to = parseInt(bulkTo, 10)
    if (isNaN(from) || isNaN(to) || from > to || to - from > 100) return

    const newUnits: ProductUnitInput[] = []
    for (let i = from; i <= to; i++) {
      const paddedNumber = String(i).padStart(String(to).length, '0')
      const identifier = `${bulkPrefix}${paddedNumber}`
      // Skip if identifier already exists
      if (!units.some((u) => u.identifier.toLowerCase() === identifier.toLowerCase())) {
        newUnits.push({ identifier, notes: '', status: 'available' })
      }
    }

    if (newUnits.length > 0) {
      onChange([...units, ...newUnits])
    }

    // Reset bulk form
    setBulkPrefix('')
    setBulkFrom('1')
    setBulkTo('5')
    setBulkOpen(false)
  }

  const getStatusBadge = (status: UnitStatus | undefined) => {
    switch (status) {
      case 'maintenance':
        return (
          <Badge variant="outline" className="border-amber-500 text-amber-600">
            {t('statusMaintenance')}
          </Badge>
        )
      case 'retired':
        return (
          <Badge variant="outline" className="border-muted-foreground text-muted-foreground">
            {t('statusRetired')}
          </Badge>
        )
      default:
        return (
          <Badge variant="outline" className="border-green-500 text-green-600">
            {t('statusAvailable')}
          </Badge>
        )
    }
  }

  return (
    <div className="space-y-4">
      {/* Quantity field (only shown when tracking is disabled) */}
      {!trackUnits && (
        <div className="space-y-2">
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
          {/* Active units count (read-only quantity) */}
          <div className="flex items-center justify-between rounded-lg bg-muted/50 p-3">
            <div className="flex items-center gap-2 text-sm">
              <Package className="h-4 w-4 text-muted-foreground" />
              <span className="text-muted-foreground">{t('quantityManagedByTracking')}</span>
            </div>
            <span className="font-medium">
              {t('activeUnits', { count: activeUnitsCount })}
            </span>
          </div>

          {/* Duplicate warning */}
          {duplicateIdentifiers.size > 0 && (
            <div className="flex items-center gap-2 rounded-md bg-destructive/10 p-3 text-sm text-destructive">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{t('duplicateIdentifier')}</span>
            </div>
          )}

          {/* Units list */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="font-medium">{t('title')}</span>
                <span className="text-sm text-muted-foreground">({units.length})</span>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={addUnit}
                disabled={disabled}
              >
                <Plus className="mr-2 h-4 w-4" />
                {t('addUnit')}
              </Button>
            </div>

            {units.length === 0 ? (
              <div className="rounded-lg border border-dashed p-6 text-center">
                <Package className="mx-auto h-8 w-8 text-muted-foreground/50" />
                <p className="mt-2 text-sm font-medium">{t('noUnitsRegistered')}</p>
                <p className="mt-1 text-xs text-muted-foreground">{t('noUnitsHint')}</p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
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
                  const isEmpty = touchedUnits.has(index) && !unit.identifier.trim()
                  const isEditingNotes = editingNotes[index]

                  return (
                    <div
                      key={unit.id || `new-${index}`}
                      className={cn(
                        'flex items-start gap-3 rounded-lg border p-3 transition-colors',
                        isDuplicate && 'border-destructive bg-destructive/5'
                      )}
                    >
                      <div className="flex-1 space-y-2">
                        <div className="flex items-center gap-2">
                          <Input
                            placeholder={t('identifierPlaceholder')}
                            value={unit.identifier}
                            onChange={(e) => updateUnit(index, 'identifier', e.target.value)}
                            onBlur={() => setTouchedUnits(prev => new Set(prev).add(index))}
                            className={cn('flex-1', (isDuplicate || isEmpty) && 'border-destructive')}
                            disabled={disabled}
                          />
                          <Select
                            value={unit.status || 'available'}
                            onValueChange={(value) =>
                              updateUnit(index, 'status', value as UnitStatus)
                            }
                            disabled={disabled}
                          >
                            <SelectTrigger className="w-[140px]">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="available">
                                <span className="flex items-center gap-2">
                                  <span className="h-2 w-2 rounded-full bg-green-500" />
                                  {t('statusAvailable')}
                                </span>
                              </SelectItem>
                              <SelectItem value="maintenance">
                                <span className="flex items-center gap-2">
                                  <span className="h-2 w-2 rounded-full bg-amber-500" />
                                  {t('statusMaintenance')}
                                </span>
                              </SelectItem>
                              <SelectItem value="retired">
                                <span className="flex items-center gap-2">
                                  <span className="h-2 w-2 rounded-full bg-gray-400" />
                                  {t('statusRetired')}
                                </span>
                              </SelectItem>
                            </SelectContent>
                          </Select>
                        </div>

                        {isEmpty && (
                          <p className="text-xs text-destructive">{t('identifierRequired')}</p>
                        )}

                        {/* Notes toggle/field */}
                        {isEditingNotes || unit.notes ? (
                          <Textarea
                            placeholder={t('notesPlaceholder')}
                            value={unit.notes || ''}
                            onChange={(e) => updateUnit(index, 'notes', e.target.value)}
                            className="min-h-[60px] text-sm"
                            disabled={disabled}
                            onBlur={() => {
                              if (!unit.notes?.trim()) {
                                setEditingNotes((prev) => ({ ...prev, [index]: false }))
                              }
                            }}
                          />
                        ) : (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-auto p-1 text-xs text-muted-foreground hover:text-foreground"
                            onClick={() => setEditingNotes((prev) => ({ ...prev, [index]: true }))}
                            disabled={disabled}
                          >
                            + {t('addNotes')}
                          </Button>
                        )}
                      </div>

                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger render={<Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              onClick={() => removeUnit(index)}
                              disabled={disabled}
                              className="mt-1 shrink-0 text-muted-foreground hover:text-destructive"
                            />}>
                              <Trash2 className="h-4 w-4" />
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>{t('deleteConfirm')}</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </div>
                  )
                })}
              </div>
            )}

            {/* Bulk add */}
            <Collapsible open={bulkOpen} onOpenChange={setBulkOpen}>
              <CollapsibleTrigger render={<Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="w-full justify-between"
                  disabled={disabled}
                />}>
                  {t('bulkAdd')}
                  <ChevronDown
                    className={cn(
                      'h-4 w-4 transition-transform',
                      bulkOpen && 'rotate-180'
                    )}
                  />
              </CollapsibleTrigger>
              <CollapsibleContent className="pt-3">
                <div className="rounded-lg border bg-muted/30 p-4">
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
                          '0'
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
            <AlertDialogClose render={<Button variant="outline" />}>{t('cancel')}</AlertDialogClose>
            <AlertDialogClose
              render={<Button />}
              onClick={confirmDisable}
            >
              {t('confirm')}
            </AlertDialogClose>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
