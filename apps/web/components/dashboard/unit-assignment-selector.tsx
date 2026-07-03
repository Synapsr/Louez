'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';

import {
  AlertCircle,
  Check,
  ChevronsUpDown,
  Loader2,
  Package,
} from 'lucide-react';
import { useTranslations } from 'next-intl';

import { toastManager } from '@louez/ui';
import { Button } from '@louez/ui';
import { Badge } from '@louez/ui';
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@louez/ui';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@louez/ui';
import { Popover, PopoverContent, PopoverTrigger } from '@louez/ui';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@louez/ui';
import { cn } from '@louez/utils';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { invalidateReservationAll } from '@/lib/orpc/invalidation';
import { orpc } from '@/lib/orpc/react';

interface AvailableUnit {
  id: string;
  identifier: string;
  notes: string | null;
}

type ActionWarning = {
  key: string;
  params?: Record<string, string | number>;
  details?: string;
};

type UnitsQueryData = {
  units: AvailableUnit[];
  assigned: string[];
};

type AssignmentFailure = {
  error: string;
  bufferConflict?: boolean;
  failedUnitIds?: string[];
  attemptedUnitIds?: string[];
};

interface UnitAssignmentSelectorProps {
  reservationId: string;
  reservationItemId: string;
  productName: string;
  quantity: number;
  trackUnits: boolean;
  initialAssignedUnitIds?: string[];
  selectedAttributes?: Record<string, string> | null;
  attributeLabelsByKey?: Record<string, string> | null;
}

export function UnitAssignmentSelector({
  reservationId,
  reservationItemId,
  productName,
  quantity,
  trackUnits,
  initialAssignedUnitIds = [],
  selectedAttributes,
  attributeLabelsByKey,
}: UnitAssignmentSelectorProps) {
  const t = useTranslations('dashboard.reservations.unitAssignment');
  const tErrors = useTranslations('errors');
  const queryClient = useQueryClient();

  const formatWarning = (warning: ActionWarning) => {
    const key = warning.key.replace('errors.', '');
    const translated = tErrors(key, warning.params || {});
    return warning.details
      ? `${translated} Cause: ${warning.details}`
      : translated;
  };

  const [isPending, startTransition] = useTransition();
  const [isLoading, setIsLoading] = useState(true);
  const [availableUnits, setAvailableUnits] = useState<AvailableUnit[]>([]);
  const [selectedUnitIds, setSelectedUnitIds] = useState<string[]>(
    initialAssignedUnitIds,
  );
  const [openPopovers, setOpenPopovers] = useState<Record<number, boolean>>({});
  const [hasChanges, setHasChanges] = useState(false);
  const [wasAutofilled, setWasAutofilled] = useState(false);
  const [bufferOverrideFailure, setBufferOverrideFailure] =
    useState<AssignmentFailure | null>(null);
  const didAutofillRef = useRef(false);
  const hasUserInteractedRef = useRef(false);

  const displayAttributes = useMemo(() => {
    const attrs = selectedAttributes || {};
    const entries = Object.entries(attrs).filter(([, value]) =>
      Boolean(value && value.trim()),
    );
    if (entries.length === 0) return [];

    const labelByKey = attributeLabelsByKey || {};
    return entries
      .sort(([a], [b]) => a.localeCompare(b, 'en'))
      .map(([key, value]) => ({
        key,
        label: labelByKey[key] || key,
        value: value.trim(),
      }));
  }, [attributeLabelsByKey, selectedAttributes]);

  const unitsQuery = useQuery({
    ...orpc.dashboard.reservations.getAvailableUnitsForItem.queryOptions({
      input: { reservationItemId },
    }),
    enabled: trackUnits,
  });

  useEffect(() => {
    if (!trackUnits) return;

    const units = unitsQuery.data?.units || [];
    const assigned = unitsQuery.data?.assigned || [];

    if (unitsQuery.isError) {
      toastManager.add({ title: tErrors('generic'), type: 'error' });
      setIsLoading(false);
      return;
    }

    if (unitsQuery.isLoading) {
      setIsLoading(true);
      return;
    }

    setAvailableUnits(units);
    if (!bufferOverrideFailure) {
      setSelectedUnitIds(assigned);
    }
    setIsLoading(false);

    if (
      !didAutofillRef.current &&
      !hasUserInteractedRef.current &&
      assigned.length === 0
    ) {
      const prefill = units.slice(0, Math.max(0, quantity)).map((u) => u.id);
      if (prefill.length > 0) {
        didAutofillRef.current = true;
        setSelectedUnitIds(prefill);
        setWasAutofilled(true);
        setHasChanges(true);
      }
    }
  }, [
    quantity,
    tErrors,
    trackUnits,
    unitsQuery.data,
    unitsQuery.isError,
    unitsQuery.isLoading,
    bufferOverrideFailure,
  ]);

  // Don't render anything if product doesn't track units
  if (!trackUnits) {
    return null;
  }

  const handleUnitSelect = (slotIndex: number, unitId: string | null) => {
    hasUserInteractedRef.current = true;
    const newSelected = [...selectedUnitIds];

    // Remove unit from any previous slot if it was selected elsewhere
    if (unitId) {
      const existingIndex = newSelected.indexOf(unitId);
      if (existingIndex !== -1 && existingIndex !== slotIndex) {
        newSelected[existingIndex] = '';
      }
    }

    // Update the current slot
    if (slotIndex < newSelected.length) {
      newSelected[slotIndex] = unitId || '';
    } else {
      // Expand array if needed
      while (newSelected.length < slotIndex) {
        newSelected.push('');
      }
      newSelected[slotIndex] = unitId || '';
    }

    setSelectedUnitIds(newSelected);
    setHasChanges(true);
    setOpenPopovers((prev) => ({ ...prev, [slotIndex]: false }));
  };

  const getUnitIdentifiers = (unitIds: string[] | undefined) => {
    if (!unitIds || unitIds.length === 0) {
      return '';
    }

    return unitIds
      .map((unitId) => getUnit(unitId)?.identifier ?? unitId)
      .join(', ');
  };

  const showAssignmentFailure = (failure: AssignmentFailure) => {
    const identifiers = getUnitIdentifiers(failure.failedUnitIds);
    toastManager.add({
      title: identifiers
        ? t('invalidUnitsToast', { identifiers })
        : tErrors(failure.error.replace('errors.', '')),
      type: 'error',
    });
  };

  const handleSave = (
    overrideTurnoverBuffer = false,
    overrideUnitIds?: string[],
  ) => {
    startTransition(async () => {
      const sourceUnitIds = overrideUnitIds ?? selectedUnitIds;
      const unitIdsToSave = sourceUnitIds.filter((id) => id && id.length > 0);
      await assignUnitsMutation.mutateAsync({
        reservationItemId,
        unitIds: unitIdsToSave,
        overrideTurnoverBuffer,
      });
    });
  };

  const assignUnitsMutation = useMutation(
    orpc.dashboard.reservations.assignUnitsToItem.mutationOptions({
      onMutate: async (input) => {
        await queryClient.cancelQueries({
          queryKey: orpc.dashboard.reservations.getAvailableUnitsForItem.key({
            input: { reservationItemId: input.reservationItemId },
          }),
        });

        const previous = queryClient.getQueryData<UnitsQueryData>(
          orpc.dashboard.reservations.getAvailableUnitsForItem.key({
            input: { reservationItemId: input.reservationItemId },
          }),
        );

        queryClient.setQueryData(
          orpc.dashboard.reservations.getAvailableUnitsForItem.key({
            input: { reservationItemId: input.reservationItemId },
          }),
          (current: UnitsQueryData | undefined) => ({
            units: current?.units || previous?.units || [],
            assigned: input.unitIds,
          }),
        );

        setHasChanges(false);
        setWasAutofilled(false);

        return { previous };
      },
      onError: (error, input, ctx) => {
        if (ctx?.previous) {
          queryClient.setQueryData(
            orpc.dashboard.reservations.getAvailableUnitsForItem.key({
              input: { reservationItemId: input.reservationItemId },
            }),
            ctx.previous,
          );
        }
        setHasChanges(true);
        toastManager.add({ title: tErrors('generic'), type: 'error' });
        void error;
      },
      onSuccess: async (result, input, ctx) => {
        if (
          result &&
          typeof result === 'object' &&
          'error' in result &&
          typeof result.error === 'string'
        ) {
          const failedUnitIds =
            'failedUnitIds' in result && Array.isArray(result.failedUnitIds)
              ? result.failedUnitIds.filter(
                  (unitId): unitId is string => typeof unitId === 'string',
                )
              : undefined;
          const failure: AssignmentFailure = {
            error: result.error,
            bufferConflict:
              'bufferConflict' in result &&
              typeof result.bufferConflict === 'boolean'
                ? result.bufferConflict
                : undefined,
            failedUnitIds,
            attemptedUnitIds: input.unitIds,
          };

          if (ctx?.previous) {
            queryClient.setQueryData(
              orpc.dashboard.reservations.getAvailableUnitsForItem.key({
                input: { reservationItemId: input.reservationItemId },
              }),
              ctx.previous,
            );
          }
          setHasChanges(true);

          if (failure.bufferConflict) {
            setBufferOverrideFailure(failure);
          } else {
            showAssignmentFailure(failure);
          }
          return;
        }

        toastManager.add({ title: t('saved'), type: 'success' });

        const warnings =
          result && typeof result === 'object' && 'warnings' in result
            ? result.warnings
            : undefined;

        if (Array.isArray(warnings) && warnings.length > 0) {
          const parsedWarnings: ActionWarning[] = warnings
            .filter(
              (warning) =>
                Boolean(warning) &&
                typeof warning === 'object' &&
                'key' in warning &&
                typeof warning.key === 'string',
            )
            .map((warning) => ({
              key: warning.key,
              params:
                warning.params &&
                typeof warning.params === 'object' &&
                !Array.isArray(warning.params)
                  ? Object.fromEntries(
                      Object.entries(warning.params).filter(
                        (entry): entry is [string, string | number] =>
                          typeof entry[1] === 'string' ||
                          typeof entry[1] === 'number',
                      ),
                    )
                  : undefined,
              details:
                typeof warning.details === 'string'
                  ? warning.details
                  : undefined,
            }));

          if (parsedWarnings.length > 0) {
            toastManager.add({
              title: parsedWarnings.map(formatWarning).join(' • '),
              type: 'warning',
            });
          }
        }

        await queryClient.invalidateQueries({
          queryKey: orpc.dashboard.reservations.getAvailableUnitsForItem.key({
            input: { reservationItemId },
          }),
        });
        await invalidateReservationAll(queryClient, reservationId);
      },
    }),
  );

  // Get assignment status
  const assignedCount = selectedUnitIds.filter(
    (id) => id && id.length > 0,
  ).length;
  const allAssigned = assignedCount === quantity;
  const noneAssigned = assignedCount === 0;

  // Get unit by ID
  const getUnit = (unitId: string) =>
    availableUnits.find((u) => u.id === unitId);

  // Get units available for a specific slot (not selected in other slots)
  const getAvailableForSlot = (slotIndex: number) => {
    const selectedInOtherSlots = selectedUnitIds.filter(
      (id, idx) => idx !== slotIndex && id,
    );
    return availableUnits.filter((u) => !selectedInOtherSlots.includes(u.id));
  };

  if (isLoading) {
    return (
      <div className="text-muted-foreground mt-2 flex items-center gap-2 text-sm">
        <Loader2 className="h-3 w-3 animate-spin" />
        <span>Loading units...</span>
      </div>
    );
  }

  return (
    <div className="bg-muted/30 mt-3 space-y-3 rounded-lg border p-3">
      {/* Header with status badge */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Package className="text-muted-foreground h-4 w-4" />
          <div className="flex flex-col">
            <span className="text-sm font-medium">{t('title')}</span>
            <span className="text-muted-foreground text-xs">{productName}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {allAssigned ? (
            <Badge
              variant="outline"
              className="border-green-500 text-green-600"
            >
              <Check className="mr-1 h-3 w-3" />
              {t('allAssigned')}
            </Badge>
          ) : noneAssigned ? (
            <Badge variant="outline" className="text-muted-foreground">
              {t('noneAssigned')}
            </Badge>
          ) : (
            <Badge
              variant="outline"
              className="border-amber-500 text-amber-600"
            >
              {t('assignedCount', { assigned: assignedCount, total: quantity })}
            </Badge>
          )}
        </div>
      </div>

      {displayAttributes.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground text-xs">
            {t('optionsLabel')}
          </span>
          <div className="flex flex-wrap gap-1">
            {displayAttributes.map((attr) => (
              <Badge key={attr.key} variant="outline" className="text-xs">
                {attr.label}: {attr.value}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* Unit slots */}
      <div className="space-y-2">
        {Array.from({ length: quantity }).map((_, index) => {
          const selectedUnitId = selectedUnitIds[index] || '';
          const selectedUnit = selectedUnitId ? getUnit(selectedUnitId) : null;
          const availableForSlot = getAvailableForSlot(index);

          return (
            <div key={index} className="flex items-center gap-2">
              <span className="text-muted-foreground w-16 text-xs">
                {t('unit', { number: index + 1 })}
              </span>
              <Popover
                open={openPopovers[index]}
                onOpenChange={(open) =>
                  setOpenPopovers((prev) => ({ ...prev, [index]: open }))
                }
              >
                <PopoverTrigger
                  render={
                    <Button
                      variant="outline"
                      role="combobox"
                      aria-expanded={openPopovers[index]}
                      className={cn(
                        'flex-1 justify-between font-normal',
                        !selectedUnit && 'text-muted-foreground',
                      )}
                      disabled={isPending}
                    />
                  }
                >
                  {selectedUnit ? (
                    <span className="flex items-center gap-2">
                      <span className="font-medium">
                        {selectedUnit.identifier}
                      </span>
                      {selectedUnit.notes && (
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger
                              render={
                                <AlertCircle className="text-muted-foreground h-3 w-3" />
                              }
                            />
                            <TooltipContent>
                              <p className="max-w-[200px] text-xs">
                                {selectedUnit.notes}
                              </p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      )}
                    </span>
                  ) : (
                    t('selectUnit')
                  )}
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </PopoverTrigger>
                <PopoverContent className="w-[280px] p-0" align="start">
                  <Command open items={availableForSlot}>
                    <CommandInput placeholder={t('selectUnit')} />
                    <CommandEmpty>{t('noUnitsAvailable')}</CommandEmpty>
                    <CommandList>
                      <CommandGroup>
                        {/* Option to clear selection */}
                        {selectedUnit && (
                          <CommandItem
                            value="__clear__"
                            onClick={() => handleUnitSelect(index, null)}
                            className="text-muted-foreground"
                          >
                            <span className="italic">
                              {t('clearSelection')}
                            </span>
                          </CommandItem>
                        )}
                        {availableForSlot.map((unit) => (
                          <CommandItem
                            key={unit.id}
                            value={unit.identifier}
                            onClick={() => handleUnitSelect(index, unit.id)}
                          >
                            <Check
                              className={cn(
                                'mr-2 h-4 w-4',
                                selectedUnitId === unit.id
                                  ? 'opacity-100'
                                  : 'opacity-0',
                              )}
                            />
                            <div className="flex flex-col">
                              <span className="font-medium">
                                {unit.identifier}
                              </span>
                              {unit.notes && (
                                <span className="text-muted-foreground line-clamp-1 text-xs">
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
          );
        })}
      </div>

      {/* Footer with save button and optional hint */}
      <div className="flex items-center justify-between pt-1">
        <div className="space-y-0.5">
          <p className="text-muted-foreground text-xs">{t('optional')}</p>
          {wasAutofilled && hasChanges && (
            <p className="text-muted-foreground text-xs">{t('autofillHint')}</p>
          )}
        </div>
        {hasChanges && (
          <Button onClick={() => handleSave()} disabled={isPending}>
            {isPending && <Loader2 className="mr-2 h-3 w-3 animate-spin" />}
            {t('save')}
          </Button>
        )}
      </div>
      <AlertDialog
        open={Boolean(bufferOverrideFailure)}
        onOpenChange={(open) => {
          if (!open) {
            setBufferOverrideFailure(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('bufferConflictTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('bufferConflictDescription', {
                identifiers: getUnitIdentifiers(
                  bufferOverrideFailure?.failedUnitIds,
                ),
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>
              {t('bufferConflictCancel')}
            </AlertDialogClose>
            <AlertDialogClose
              render={<Button />}
              onClick={() => {
                const request = bufferOverrideFailure;
                setBufferOverrideFailure(null);
                handleSave(true, request?.attemptedUnitIds);
              }}
            >
              {t('bufferConflictConfirm')}
            </AlertDialogClose>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
