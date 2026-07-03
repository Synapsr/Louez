'use client';

import { useEffect, useMemo, useState } from 'react';

import {
  AlertCircle,
  ChevronDown,
  Euro,
  Lightbulb,
  Package,
  Plus,
  Settings2,
  Sparkles,
  StickyNote,
  Trash2,
} from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button } from '@louez/ui';
import { Input } from '@louez/ui';
import { Label } from '@louez/ui';
import { Switch } from '@louez/ui';
import { Badge } from '@louez/ui';
import { Textarea } from '@louez/ui';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@louez/ui';
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
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
  DialogTrigger,
} from '@louez/ui';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@louez/ui';
import { cn, normalizeAxisKey, toDatePickerValue } from '@louez/utils';

import { DatePicker } from '@/components/ui/date-time-picker';

type UnitLifecycleStatus = 'active' | 'retired';

interface ProductUnitInput {
  id?: string;
  identifier: string;
  notes?: string;
  lifecycleStatus?: UnitLifecycleStatus;
  purchasePrice?: string | null;
  purchasedAt?: string | Date | null;
  attributes?: Record<string, string>;
}

interface BookingAttributeAxisInput {
  key: string;
  label: string;
  position: number;
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
  value: string;
  onChange: (value: string) => void;
  suggestions: string[];
  placeholder: string;
  disabled: boolean;
  hasError: boolean;
  createHint: (value: string) => string;
}) {
  const [localValue, setLocalValue] = useState(value);
  const [open, setOpen] = useState(false);

  // Sync from parent when value changes externally
  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  const filtered = useMemo(() => {
    if (!localValue.trim()) return suggestions;
    const lower = localValue.toLowerCase();
    return suggestions.filter((s) => s.toLowerCase().includes(lower));
  }, [suggestions, localValue]);

  const trimmed = localValue.trim();
  const isNewValue =
    trimmed.length > 0 &&
    !suggestions.some((s) => s.toLowerCase() === trimmed.toLowerCase());

  return (
    <div className="relative">
      <Input
        value={localValue}
        onChange={(e) => setLocalValue(e.target.value)}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          setTimeout(() => setOpen(false), 150);
          if (localValue !== value) onChange(localValue);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            onChange(localValue);
            setOpen(false);
            e.currentTarget.blur();
          }
        }}
        placeholder={placeholder}
        disabled={disabled}
        className={cn(
          hasError && !localValue.trim() && 'border-destructive/60',
        )}
      />
      {open && (filtered.length > 0 || isNewValue) && (
        <div className="bg-popover absolute z-50 mt-1 max-h-[200px] w-full overflow-y-auto rounded-lg border p-1 shadow-lg">
          {filtered.map((s) => (
            <button
              key={s}
              type="button"
              className={cn(
                'hover:bg-accent hover:text-accent-foreground w-full cursor-default rounded-sm px-2 py-1.5 text-left text-sm outline-none',
                s === localValue && 'bg-accent/50 font-medium',
              )}
              onMouseDown={(e) => {
                e.preventDefault();
                setLocalValue(s);
                onChange(s);
                setOpen(false);
              }}
            >
              {s}
            </button>
          ))}
          {isNewValue && (
            <p className="text-muted-foreground px-2 py-1.5 text-xs">
              {createHint(trimmed)}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function BookingAttributesDialog({
  axes,
  onAddAxis,
  onRemoveAxis,
  disabled,
}: {
  axes: BookingAttributeAxisInput[];
  onAddAxis: (label: string) => void;
  onRemoveAxis: (key: string) => void;
  disabled: boolean;
}) {
  const t = useTranslations('dashboard.products.form.unitTracking');
  const [newAxisLabel, setNewAxisLabel] = useState('');

  const handleAdd = () => {
    const label = newAxisLabel.trim();
    if (!label) return;
    onAddAxis(label);
    setNewAxisLabel('');
  };

  return (
    <Dialog>
      <DialogTrigger
        render={
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={disabled}
          />
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
          <DialogDescription>
            {t('manageAttributesDescription')}
          </DialogDescription>
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
                    e.preventDefault();
                    handleAdd();
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
                      <span className="bg-muted flex h-5 w-5 items-center justify-center rounded-md text-xs font-medium">
                        {axis.position + 1}
                      </span>
                      <span className="text-sm font-medium">{axis.label}</span>
                      <span className="text-muted-foreground font-mono text-xs">
                        {axis.key}
                      </span>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="text-muted-foreground hover:text-destructive h-7 w-7"
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
                <p className="text-muted-foreground text-sm">
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
  );
}

function UnitRow({
  unit,
  index,
  unitCount,
  bookingAttributeAxes,
  existingValuesByAxis,
  isDuplicate,
  isEmpty,
  disabled,
  onUpdate,
  onUpdateAttribute,
  onRemove,
  onTouch,
  onApplyPurchaseToAll,
}: {
  unit: ProductUnitInput;
  index: number;
  unitCount: number;
  bookingAttributeAxes: BookingAttributeAxisInput[];
  existingValuesByAxis: Record<string, string[]>;
  isDuplicate: boolean;
  isEmpty: boolean;
  disabled: boolean;
  onUpdate: (index: number, patch: Partial<ProductUnitInput>) => void;
  onUpdateAttribute: (index: number, axisKey: string, value: string) => void;
  onRemove: (index: number) => void;
  onTouch: (index: number) => void;
  onApplyPurchaseToAll: (index: number) => void;
}) {
  const t = useTranslations('dashboard.products.form.unitTracking');
  const tReservationForm = useTranslations('dashboard.reservations.manualForm');
  const [detailsOpen, setDetailsOpen] = useState(false);
  const hasAxes = bookingAttributeAxes.length > 0;
  const isRetired = (unit.lifecycleStatus || 'active') === 'retired';

  const hasNotes = !!unit.notes?.trim();
  const hasPurchase =
    !!(typeof unit.purchasePrice === 'string' && unit.purchasePrice.trim()) ||
    !!unit.purchasedAt;
  const canApplyToAll = unitCount > 1 && hasPurchase;

  return (
    <div
      className={cn(
        'rounded-lg border transition-colors',
        isDuplicate && 'border-destructive bg-destructive/5',
      )}
    >
      <Collapsible open={detailsOpen} onOpenChange={setDetailsOpen}>
        <div className="px-3 py-2">
          {/* Line 1: dot + identifier + indicators + expand + delete */}
          <div className="flex items-center gap-2">
            <span
              className={cn(
                'h-2 w-2 shrink-0 rounded-full',
                isRetired ? 'bg-gray-400' : 'bg-green-500',
              )}
            />
            <Input
              placeholder={t('identifierPlaceholder')}
              value={unit.identifier}
              onChange={(e) => onUpdate(index, { identifier: e.target.value })}
              onBlur={() => onTouch(index)}
              className={cn(
                'h-8 flex-1',
                (isDuplicate || isEmpty) && 'border-destructive',
              )}
              disabled={disabled}
            />
            {isRetired && (
              <Badge variant="outline">{t('lifecycleRetired')}</Badge>
            )}
            {hasNotes && (
              <StickyNote className="text-muted-foreground h-3.5 w-3.5 shrink-0" />
            )}
            {hasPurchase && (
              <Euro className="text-muted-foreground h-3.5 w-3.5 shrink-0" />
            )}
            <CollapsibleTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="text-muted-foreground h-8 w-8 shrink-0"
                  disabled={disabled}
                  aria-label={t('unitDetails')}
                />
              }
            >
              <ChevronDown
                className={cn(
                  'h-4 w-4 transition-transform duration-200 ease-out',
                  detailsOpen && 'rotate-180',
                )}
              />
            </CollapsibleTrigger>
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
                      className="text-muted-foreground hover:text-destructive h-8 w-8 shrink-0"
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
            <p className="text-destructive mt-1.5 text-xs">
              {t('identifierRequired')}
            </p>
          )}

          {/* Line 2: attribute values (only when axes exist — required data) */}
          {hasAxes && (
            <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {bookingAttributeAxes.map((axis) => {
                const suggestions = existingValuesByAxis[axis.key] || [];
                const currentValue = unit.attributes?.[axis.key] || '';
                const hasError = !currentValue.trim() && !isRetired;

                return (
                  <div key={axis.key} className="space-y-1">
                    <Label className="text-muted-foreground text-xs">
                      {axis.label}
                    </Label>
                    <AttributeValueCombobox
                      value={currentValue}
                      onChange={(val) =>
                        onUpdateAttribute(index, axis.key, val)
                      }
                      suggestions={suggestions}
                      placeholder={t('bookingAttributeValuePlaceholder', {
                        label: axis.label,
                      })}
                      disabled={disabled}
                      hasError={hasError}
                      createHint={(v) => t('pressEnterToCreate', { value: v })}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Expanded details: purchase metadata + notes */}
        <CollapsibleContent>
          <div className="space-y-3 border-t px-3 pt-3 pb-3">
            <div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground text-xs font-medium">
                  {t('purchaseDetails')}
                </span>
                {canApplyToAll && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground h-6 px-2 text-xs"
                    onClick={() => onApplyPurchaseToAll(index)}
                    disabled={disabled}
                  >
                    {t('applyPurchaseToAll')}
                  </Button>
                )}
              </div>
              <div className="mt-1.5 grid gap-2 sm:grid-cols-2">
                <Input
                  inputMode="decimal"
                  placeholder={t('purchasePricePlaceholder')}
                  aria-label={t('purchasePrice')}
                  value={
                    typeof unit.purchasePrice === 'string'
                      ? unit.purchasePrice
                      : ''
                  }
                  onChange={(e) =>
                    onUpdate(index, { purchasePrice: e.target.value })
                  }
                  disabled={disabled}
                />
                <DatePicker
                  date={toDatePickerValue(unit.purchasedAt)}
                  setDate={(date) =>
                    onUpdate(index, {
                      purchasedAt: date ?? null,
                    })
                  }
                  disabled={disabled}
                  placeholder={tReservationForm('pickDate')}
                />
              </div>
            </div>
            <div>
              <span className="text-muted-foreground text-xs font-medium">
                {t('notes')}
              </span>
              <Textarea
                placeholder={t('notesPlaceholder')}
                value={unit.notes || ''}
                onChange={(e) => onUpdate(index, { notes: e.target.value })}
                className="mt-1.5 min-h-[60px] text-sm"
                disabled={disabled}
              />
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

interface UnitTrackingEditorProps {
  trackUnits: boolean;
  onTrackUnitsChange: (value: boolean) => void;
  bookingAttributeAxes: BookingAttributeAxisInput[];
  onBookingAttributeAxesChange: (axes: BookingAttributeAxisInput[]) => void;
  units: ProductUnitInput[];
  onChange: (units: ProductUnitInput[]) => void;
  quantity: string;
  onQuantityChange: (value: string) => void;
  defaultPrefix?: string;
  disabled?: boolean;
  showValidationErrors?: boolean;
}

const MAX_GENERATED_UNITS = 100;

function getNextSequenceNumber(
  units: ProductUnitInput[],
  prefix: string,
): number {
  const pattern = new RegExp(
    `^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}0*(\\d+)$`,
    'i',
  );
  let max = 0;
  for (const unit of units) {
    const match = unit.identifier.trim().match(pattern);
    if (match) {
      const value = parseInt(match[1], 10);
      if (!isNaN(value) && value > max) max = value;
    }
  }
  return max + 1;
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
  defaultPrefix = '',
  disabled = false,
  showValidationErrors = false,
}: UnitTrackingEditorProps) {
  const t = useTranslations('dashboard.products.form.unitTracking');
  const [showDisableConfirm, setShowDisableConfirm] = useState(false);
  const [genPrefix, setGenPrefix] = useState('');
  const [genCount, setGenCount] = useState('5');
  const [touchedUnits, setTouchedUnits] = useState<Set<number>>(new Set());

  const effectivePrefix = genPrefix || defaultPrefix;

  const activeUnitsCount = useMemo(() => {
    return units.filter((u) => (u.lifecycleStatus || 'active') === 'active')
      .length;
  }, [units]);

  const duplicateIdentifiers = useMemo(() => {
    const seen = new Set<string>();
    const duplicates = new Set<string>();
    for (const unit of units) {
      const normalized = unit.identifier.trim().toLowerCase();
      if (normalized && seen.has(normalized)) {
        duplicates.add(normalized);
      }
      seen.add(normalized);
    }
    return duplicates;
  }, [units]);

  const existingValuesByAxis = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const axis of bookingAttributeAxes) {
      const uniqueValues = new Set<string>();
      for (const unit of units) {
        const val = unit.attributes?.[axis.key]?.trim();
        if (val) uniqueValues.add(val);
      }
      map[axis.key] = Array.from(uniqueValues).sort();
    }
    return map;
  }, [bookingAttributeAxes, units]);

  const missingAttributeCount = useMemo(() => {
    if (bookingAttributeAxes.length === 0) return 0;
    return units.filter((unit) => {
      const lifecycleStatus = unit.lifecycleStatus || 'active';
      if (lifecycleStatus !== 'active') return false;
      return bookingAttributeAxes.some(
        (axis) => !unit.attributes?.[axis.key]?.trim(),
      );
    }).length;
  }, [bookingAttributeAxes, units]);

  const generationPreview = useMemo(() => {
    const count = Math.min(
      parseInt(genCount, 10) || 0,
      MAX_GENERATED_UNITS,
    );
    if (!effectivePrefix.trim() || count < 1) return null;
    const from = getNextSequenceNumber(units, effectivePrefix.trim());
    const to = from + count - 1;
    const padLength = Math.max(2, String(to).length);
    const first = `${effectivePrefix.trim()}${String(from).padStart(padLength, '0')}`;
    if (count === 1) return first;
    const last = `${effectivePrefix.trim()}${String(to).padStart(padLength, '0')}`;
    return `${first} … ${last}`;
  }, [effectivePrefix, genCount, units]);

  const handleToggle = (enabled: boolean) => {
    if (!enabled && units.length > 0) {
      setShowDisableConfirm(true);
      return;
    }
    onTrackUnitsChange(enabled);
    if (enabled && units.length === 0) {
      // Seed the generator with the declared quantity instead of creating
      // empty (and invalid) unit rows.
      const qty = parseInt(quantity, 10);
      if (!isNaN(qty) && qty > 0) {
        setGenCount(String(Math.min(qty, MAX_GENERATED_UNITS)));
      }
    }
  };

  const confirmDisable = () => {
    onTrackUnitsChange(false);
    onBookingAttributeAxesChange([]);
    onChange([]);
    setShowDisableConfirm(false);
  };

  const addUnit = () => {
    onChange([
      ...units,
      {
        identifier: '',
        notes: '',
        lifecycleStatus: 'active',
        purchasePrice: '',
        purchasedAt: null,
        attributes: {},
      },
    ]);
  };

  const removeUnit = (index: number) => {
    onChange(units.filter((_, i) => i !== index));
  };

  const updateUnit = (index: number, patch: Partial<ProductUnitInput>) => {
    const newUnits = [...units];
    newUnits[index] = { ...newUnits[index], ...patch };
    onChange(newUnits);
  };

  const updateUnitAttribute = (
    index: number,
    axisKey: string,
    value: string,
  ) => {
    const newUnits = [...units];
    const currentAttributes = newUnits[index].attributes || {};
    newUnits[index] = {
      ...newUnits[index],
      attributes: {
        ...currentAttributes,
        [axisKey]: value,
      },
    };
    onChange(newUnits);
  };

  const applyPurchaseToAll = (sourceIndex: number) => {
    const source = units[sourceIndex];
    if (!source) return;
    onChange(
      units.map((unit) => ({
        ...unit,
        purchasePrice: source.purchasePrice,
        purchasedAt: source.purchasedAt,
      })),
    );
  };

  const addBookingAxis = (label: string) => {
    const trimmed = label.trim();
    if (!trimmed) return;
    const key = normalizeAxisKey(trimmed);
    if (!key) return;
    if (bookingAttributeAxes.some((axis) => axis.key === key)) return;
    if (bookingAttributeAxes.length >= 3) return;

    onBookingAttributeAxesChange([
      ...bookingAttributeAxes,
      { key, label: trimmed, position: bookingAttributeAxes.length },
    ]);
  };

  const removeBookingAxis = (key: string) => {
    const nextAxes = bookingAttributeAxes
      .filter((axis) => axis.key !== key)
      .map((axis, index) => ({ ...axis, position: index }));
    onBookingAttributeAxesChange(nextAxes);

    if (units.length > 0) {
      const nextUnits = units.map((unit) => {
        const attributes = { ...(unit.attributes || {}) };
        delete attributes[key];
        return { ...unit, attributes };
      });
      onChange(nextUnits);
    }
  };

  const handleGenerate = () => {
    const prefix = effectivePrefix.trim();
    const count = Math.min(parseInt(genCount, 10) || 0, MAX_GENERATED_UNITS);
    if (!prefix || count < 1) return;

    const from = getNextSequenceNumber(units, prefix);
    const to = from + count - 1;
    const padLength = Math.max(2, String(to).length);

    const newUnits: ProductUnitInput[] = [];
    for (let i = from; i <= to; i++) {
      const identifier = `${prefix}${String(i).padStart(padLength, '0')}`;
      if (
        !units.some(
          (u) => u.identifier.toLowerCase() === identifier.toLowerCase(),
        )
      ) {
        newUnits.push({
          identifier,
          notes: '',
          lifecycleStatus: 'active',
          purchasePrice: '',
          purchasedAt: null,
          attributes: {},
        });
      }
    }

    if (newUnits.length > 0) {
      onChange([...units, ...newUnits]);
    }
  };

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
          <Label
            htmlFor="unit-tracking-toggle"
            className="text-base font-medium"
          >
            {t('toggle')}
          </Label>
          <p className="text-muted-foreground text-sm">
            {t('toggleDescription')}
          </p>
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
          {/* Generator — the primary way to declare units */}
          <div className="bg-muted/40 rounded-lg border p-3">
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-[120px] flex-1 space-y-1">
                <Label className="text-muted-foreground text-xs">
                  {t('bulkPrefix')}
                </Label>
                <Input
                  placeholder={defaultPrefix || t('bulkPrefixPlaceholder')}
                  value={genPrefix}
                  onChange={(e) => setGenPrefix(e.target.value)}
                  disabled={disabled}
                  className="h-8"
                />
              </div>
              <div className="w-24 space-y-1">
                <Label className="text-muted-foreground text-xs">
                  {t('generatorCount')}
                </Label>
                <Input
                  type="number"
                  min="1"
                  max={MAX_GENERATED_UNITS}
                  value={genCount}
                  onChange={(e) => setGenCount(e.target.value)}
                  disabled={disabled}
                  className="h-8"
                />
              </div>
              <Button
                type="button"
                size="sm"
                onClick={handleGenerate}
                disabled={disabled || !effectivePrefix.trim()}
              >
                <Sparkles className="h-3.5 w-3.5" />
                {t('bulkGenerate')}
              </Button>
            </div>
            <p className="text-muted-foreground mt-2 text-xs">
              {generationPreview
                ? `${t('bulkPreview')} : ${generationPreview}`
                : t('generatorHint')}
            </p>
          </div>

          {/* Header: count + actions */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Package className="text-muted-foreground h-4 w-4" />
              <span className="font-medium">{t('title')}</span>
              <Badge variant="outline">
                {t('activeUnits', { count: activeUnitsCount })}
              </Badge>
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
              <span className="text-muted-foreground text-xs">
                {t('bookingAttributesTitle')}:
              </span>
              {bookingAttributeAxes.map((axis) => (
                <Badge
                  key={axis.key}
                  variant="secondary"
                  className="gap-1 pr-1"
                >
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

          {/* Unit rows or empty hint */}
          {units.length === 0 ? (
            <div className="rounded-lg border border-dashed p-6 text-center">
              <p className="text-sm font-medium">{t('noUnitsRegistered')}</p>
              <p className="text-muted-foreground mt-1 text-xs">
                {t('noUnitsHint')}
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {units.map((unit, index) => {
                const isDuplicate =
                  unit.identifier.trim() &&
                  duplicateIdentifiers.has(
                    unit.identifier.trim().toLowerCase(),
                  );
                const isEmpty =
                  (touchedUnits.has(index) || showValidationErrors) &&
                  !unit.identifier.trim();

                return (
                  <UnitRow
                    key={unit.id || `new-${index}`}
                    unit={unit}
                    index={index}
                    unitCount={units.length}
                    bookingAttributeAxes={bookingAttributeAxes}
                    existingValuesByAxis={existingValuesByAxis}
                    isDuplicate={!!isDuplicate}
                    isEmpty={isEmpty}
                    disabled={disabled}
                    onUpdate={updateUnit}
                    onUpdateAttribute={updateUnitAttribute}
                    onRemove={removeUnit}
                    onTouch={(i) =>
                      setTouchedUnits((prev) => new Set(prev).add(i))
                    }
                    onApplyPurchaseToAll={applyPurchaseToAll}
                  />
                );
              })}
            </div>
          )}

          {/* Warnings */}
          {duplicateIdentifiers.size > 0 && (
            <div className="bg-destructive/10 text-destructive flex items-center gap-2 rounded-md p-3 text-sm">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{t('duplicateIdentifier')}</span>
            </div>
          )}

          {missingAttributeCount > 0 && (
            <div className="bg-destructive/10 text-destructive flex items-center gap-2 rounded-md p-3 text-sm">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>
                {t('missingAttributesWarning', {
                  count: missingAttributeCount,
                })}
              </span>
            </div>
          )}
        </>
      )}

      {/* Disable confirmation dialog */}
      <AlertDialog
        open={showDisableConfirm}
        onOpenChange={setShowDisableConfirm}
      >
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
  );
}
