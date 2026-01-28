'use client'

import { useState, useEffect, useTransition } from 'react'
import { Check, ChevronsUpDown, Package, Loader2, AlertCircle } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import {
  assignUnitsToReservationItem,
  getAvailableUnitsForReservationItem,
} from '@/app/(dashboard)/dashboard/reservations/actions'

interface AvailableUnit {
  id: string
  identifier: string
  notes: string | null
}

interface UnitAssignmentSelectorProps {
  reservationItemId: string
  productName: string
  quantity: number
  trackUnits: boolean
  initialAssignedUnitIds?: string[]
}

export function UnitAssignmentSelector({
  reservationItemId,
  productName,
  quantity,
  trackUnits,
  initialAssignedUnitIds = [],
}: UnitAssignmentSelectorProps) {
  const t = useTranslations('dashboard.reservations.unitAssignment')
  const tErrors = useTranslations('errors')

  const [isPending, startTransition] = useTransition()
  const [isLoading, setIsLoading] = useState(true)
  const [availableUnits, setAvailableUnits] = useState<AvailableUnit[]>([])
  const [selectedUnitIds, setSelectedUnitIds] = useState<string[]>(initialAssignedUnitIds)
  const [openPopovers, setOpenPopovers] = useState<Record<number, boolean>>({})
  const [hasChanges, setHasChanges] = useState(false)

  // Load available units on mount
  useEffect(() => {
    if (!trackUnits) return

    async function loadUnits() {
      setIsLoading(true)
      const result = await getAvailableUnitsForReservationItem(reservationItemId)
      if (result.error) {
        toast.error(tErrors(result.error))
      } else {
        setAvailableUnits(result.units || [])
        setSelectedUnitIds(result.assigned || [])
      }
      setIsLoading(false)
    }

    loadUnits()
  }, [reservationItemId, trackUnits, tErrors])

  // Don't render anything if product doesn't track units
  if (!trackUnits) {
    return null
  }

  const handleUnitSelect = (slotIndex: number, unitId: string | null) => {
    const newSelected = [...selectedUnitIds]

    // Remove unit from any previous slot if it was selected elsewhere
    if (unitId) {
      const existingIndex = newSelected.indexOf(unitId)
      if (existingIndex !== -1 && existingIndex !== slotIndex) {
        newSelected[existingIndex] = ''
      }
    }

    // Update the current slot
    if (slotIndex < newSelected.length) {
      newSelected[slotIndex] = unitId || ''
    } else {
      // Expand array if needed
      while (newSelected.length < slotIndex) {
        newSelected.push('')
      }
      newSelected[slotIndex] = unitId || ''
    }

    setSelectedUnitIds(newSelected)
    setHasChanges(true)
    setOpenPopovers((prev) => ({ ...prev, [slotIndex]: false }))
  }

  const handleSave = () => {
    startTransition(async () => {
      // Filter out empty strings and get only valid unit IDs
      const unitIdsToSave = selectedUnitIds.filter((id) => id && id.length > 0)
      const result = await assignUnitsToReservationItem(reservationItemId, unitIdsToSave)

      if (result.error) {
        toast.error(tErrors(result.error))
      } else {
        toast.success(t('saved'))
        setHasChanges(false)
      }
    })
  }

  // Get assignment status
  const assignedCount = selectedUnitIds.filter((id) => id && id.length > 0).length
  const allAssigned = assignedCount === quantity
  const noneAssigned = assignedCount === 0

  // Get unit by ID
  const getUnit = (unitId: string) => availableUnits.find((u) => u.id === unitId)

  // Get units available for a specific slot (not selected in other slots)
  const getAvailableForSlot = (slotIndex: number) => {
    const selectedInOtherSlots = selectedUnitIds.filter((id, idx) => idx !== slotIndex && id)
    return availableUnits.filter((u) => !selectedInOtherSlots.includes(u.id))
  }

  if (isLoading) {
    return (
      <div className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        <span>Loading units...</span>
      </div>
    )
  }

  return (
    <div className="mt-3 space-y-3 rounded-lg border bg-muted/30 p-3">
      {/* Header with status badge */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Package className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">{t('title')}</span>
        </div>
        <div className="flex items-center gap-2">
          {allAssigned ? (
            <Badge variant="outline" className="border-green-500 text-green-600">
              <Check className="mr-1 h-3 w-3" />
              {t('allAssigned')}
            </Badge>
          ) : noneAssigned ? (
            <Badge variant="outline" className="text-muted-foreground">
              {t('noneAssigned')}
            </Badge>
          ) : (
            <Badge variant="outline" className="border-amber-500 text-amber-600">
              {t('assignedCount', { assigned: assignedCount, total: quantity })}
            </Badge>
          )}
        </div>
      </div>

      {/* Unit slots */}
      <div className="space-y-2">
        {Array.from({ length: quantity }).map((_, index) => {
          const selectedUnitId = selectedUnitIds[index] || ''
          const selectedUnit = selectedUnitId ? getUnit(selectedUnitId) : null
          const availableForSlot = getAvailableForSlot(index)

          return (
            <div key={index} className="flex items-center gap-2">
              <span className="w-16 text-xs text-muted-foreground">
                {t('unit', { number: index + 1 })}
              </span>
              <Popover
                open={openPopovers[index]}
                onOpenChange={(open) => setOpenPopovers((prev) => ({ ...prev, [index]: open }))}
              >
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    role="combobox"
                    aria-expanded={openPopovers[index]}
                    className={cn(
                      'flex-1 justify-between font-normal',
                      !selectedUnit && 'text-muted-foreground'
                    )}
                    disabled={isPending}
                  >
                    {selectedUnit ? (
                      <span className="flex items-center gap-2">
                        <span className="font-medium">{selectedUnit.identifier}</span>
                        {selectedUnit.notes && (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <AlertCircle className="h-3 w-3 text-muted-foreground" />
                              </TooltipTrigger>
                              <TooltipContent>
                                <p className="max-w-[200px] text-xs">{selectedUnit.notes}</p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        )}
                      </span>
                    ) : (
                      t('selectUnit')
                    )}
                    <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-[280px] p-0" align="start">
                  <Command>
                    <CommandInput placeholder={t('selectUnit')} />
                    <CommandList>
                      <CommandEmpty>{t('noUnitsAvailable')}</CommandEmpty>
                      <CommandGroup>
                        {/* Option to clear selection */}
                        {selectedUnit && (
                          <CommandItem
                            value="__clear__"
                            onSelect={() => handleUnitSelect(index, null)}
                            className="text-muted-foreground"
                          >
                            <span className="italic">Clear selection</span>
                          </CommandItem>
                        )}
                        {availableForSlot.map((unit) => (
                          <CommandItem
                            key={unit.id}
                            value={unit.identifier}
                            onSelect={() => handleUnitSelect(index, unit.id)}
                          >
                            <Check
                              className={cn(
                                'mr-2 h-4 w-4',
                                selectedUnitId === unit.id ? 'opacity-100' : 'opacity-0'
                              )}
                            />
                            <div className="flex flex-col">
                              <span className="font-medium">{unit.identifier}</span>
                              {unit.notes && (
                                <span className="text-xs text-muted-foreground line-clamp-1">
                                  {unit.notes}
                                </span>
                              )}
                            </div>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </div>
          )
        })}
      </div>

      {/* Footer with save button and optional hint */}
      <div className="flex items-center justify-between pt-1">
        <p className="text-xs text-muted-foreground">{t('optional')}</p>
        {hasChanges && (
          <Button size="sm" onClick={handleSave} disabled={isPending}>
            {isPending && <Loader2 className="mr-2 h-3 w-3 animate-spin" />}
            {t('save')}
          </Button>
        )}
      </div>
    </div>
  )
}
