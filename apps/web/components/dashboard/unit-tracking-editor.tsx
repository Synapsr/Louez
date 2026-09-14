"use client";

import { useMemo, useRef, useState, type Ref } from "react";

import Link from "next/link";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  ImagePlus,
  Loader2,
  Plus,
  Settings2,
  Trash2,
  X,
} from "lucide-react";
import { useTranslations } from "next-intl";

import { Button, InputPrice, Separator } from "@louez/ui";
import { Input } from "@louez/ui";
import { InputQuantity } from "@louez/ui";
import { Label } from "@louez/ui";
import { Badge } from "@louez/ui";
import { Textarea } from "@louez/ui";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@louez/ui";
import {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxCollection,
  ComboboxGroup,
  ComboboxGroupLabel,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  ComboboxValue,
} from "@louez/ui";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@louez/ui";
import { toastManager } from "@louez/ui";
import {
  cn,
  canonicalizeAttributes,
  findMatchingVariant,
  getCurrencySymbol,
  hasCompleteAttributes,
  normalizeAxisKey,
  toDatePickerValue,
} from "@louez/utils";

import {
  buildVariantRegistry,
  type VariantCatalogDefinition,
  type VariantRegistryEntry,
} from "@/components/dashboard/util.variant-registry";
import { VariantManagerDrawer } from "@/components/dashboard/variant-manager";
import { ReservationDatePickerControl } from "@/components/form/form-reservation-date-picker";
import { useImageUpload } from "@/hooks/use-image-upload";
import { orpc } from "@/lib/orpc/react";
import { IMAGE_UPLOAD_MIME_TYPES } from "@/lib/uploads/image-upload";
import { filterActiveVariantAxes } from "@/lib/util.variant-visibility";
import { resolveVariantPresets } from "@/lib/variant-presets";

interface ProductUnitInput {
  id?: string;
  identifier: string;
  notes?: string;
  purchasePrice?: string | null;
  purchasedAt?: string | Date | null;
  images?: string[];
  attributes?: Record<string, string>;
  hasActiveAssignment?: boolean;
}

const MAX_UNIT_IMAGES = 4;

interface BookingAttributeAxisInput {
  key: string;
  label: string;
  position: number;
}

interface EnsureDefinitionInput {
  key?: string;
  label: string;
  kind: "size" | "color" | "custom";
  isActive?: boolean;
  values: Array<{ label: string; colorHex?: string }>;
}

// One color per variant axis — chips on unit rows, dots in the axes list and popup.
const AXIS_CHIP_CLASSES = [
  "bg-blue-500/10 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300",
  "bg-amber-500/10 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  "bg-violet-500/10 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300",
];

const AXIS_BADGE_VARIANTS = ["progress", "pending", "submitted"] as const;

interface VariantItemData {
  value: string;
  label: string;
  axisKey: string;
  axisLabel: string;
  axisIndex: number;
  colorHex: string | null;
  kind?: "create";
}

interface VariantGroupData {
  value: string;
  label: string;
  colorIndex: number;
  items: VariantItemData[];
}

const getVariantSearchRank = (label: string, query: string) => {
  if (!query) return 0;

  const normalizedLabel = normalizeAxisKey(label);
  const normalizedQuery = normalizeAxisKey(query);
  if (normalizedLabel === normalizedQuery) return 0;
  if (normalizedLabel.startsWith(normalizedQuery)) return 1;
  if (normalizedLabel.includes(normalizedQuery)) return 2;
  return 3;
};

/** Real color swatch — only shown for values of a color-kind variant. */
function ColorSwatch({ colorHex }: { colorHex: string }) {
  return (
    <span
      className="h-2 w-2 shrink-0 rounded-full ring-1 ring-black/15 ring-inset"
      style={{ backgroundColor: colorHex }}
    />
  );
}

/**
 * Categories-style multi combobox for a unit's variant values: one chip per
 * axis (colored by axis), typing suggests known values and offers per-axis
 * creation. Selecting a second value for an axis replaces the previous one.
 */
function UnitVariantsCombobox({
  registry,
  attributes,
  existingValuesByAxis,
  disabled,
  hasError,
  onApply,
  onPersistValue,
  createLabel,
  manageLabel,
  onManage,
  inputRef,
  ariaLabel,
}: {
  registry: VariantRegistryEntry[];
  attributes: Record<string, string> | undefined;
  existingValuesByAxis: Record<string, string[]>;
  disabled: boolean;
  hasError: boolean;
  onApply: (patch: Record<string, string>) => void;
  onPersistValue?: (axisKey: string, label: string) => void;
  createLabel: (value: string, axis: string) => string;
  manageLabel: string;
  onManage: () => void;
  inputRef?: Ref<HTMLInputElement>;
  ariaLabel?: string;
}) {
  const [query, setQuery] = useState("");

  // Popup items grouped by variant, one section per registry entry.
  const groups = useMemo<VariantGroupData[]>(() => {
    const result: VariantGroupData[] = [];
    const trimmed = query.trim();

    for (const entry of registry) {
      const seen = new Set<string>();
      const groupItems: VariantItemData[] = [];
      // Catalog/preset values first (shared across products), then ad-hoc
      // values already used by this product's units.
      for (const value of entry.values) {
        if (seen.has(value.label.toLowerCase())) continue;
        seen.add(value.label.toLowerCase());
        groupItems.push({
          value: `${entry.key}::${value.label}`,
          label: value.label,
          axisKey: entry.key,
          axisLabel: entry.label,
          axisIndex: entry.colorIndex,
          colorHex: value.colorHex,
        });
      }
      for (const value of existingValuesByAxis[entry.key] || []) {
        if (seen.has(value.toLowerCase())) continue;
        seen.add(value.toLowerCase());
        groupItems.push({
          value: `${entry.key}::${value}`,
          label: value,
          axisKey: entry.key,
          axisLabel: entry.label,
          axisIndex: entry.colorIndex,
          colorHex: null,
        });
      }
      if (trimmed && !seen.has(trimmed.toLowerCase())) {
        groupItems.push({
          value: `create::${entry.key}`,
          label: trimmed,
          axisKey: entry.key,
          axisLabel: entry.label,
          axisIndex: entry.colorIndex,
          colorHex: null,
          kind: "create",
        });
      }
      if (trimmed) {
        groupItems.sort((left, right) => {
          if (left.kind === "create") return 1;
          if (right.kind === "create") return -1;
          return (
            getVariantSearchRank(left.label, trimmed) - getVariantSearchRank(right.label, trimmed)
          );
        });
      }
      if (groupItems.length > 0) {
        result.push({
          value: entry.key,
          label: entry.label,
          colorIndex: entry.colorIndex,
          items: groupItems,
        });
      }
    }
    if (trimmed) {
      result.sort((left, right) => {
        const bestRank = (group: VariantGroupData) =>
          Math.min(
            ...group.items
              .filter((item) => item.kind !== "create")
              .map((item) => getVariantSearchRank(item.label, trimmed))
              .filter((rank) => rank < 3),
            4,
          );
        return bestRank(left) - bestRank(right);
      });
    }
    return result;
  }, [registry, existingValuesByAxis, query]);

  const items = useMemo(() => groups.flatMap((group) => group.items), [groups]);

  // Case-insensitive lookup: a unit may hold "m" while the catalog lists "M".
  const itemsByValue = useMemo(
    () =>
      new Map(
        items
          .filter((item) => !item.kind)
          .map((item) => [`${item.axisKey}::${item.label.toLowerCase()}`, item]),
      ),
    [items],
  );

  const selectedItems = registry.flatMap((entry) => {
    const value = attributes?.[entry.key]?.trim();
    if (!value) return [];
    const item = itemsByValue.get(`${entry.key}::${value.toLowerCase()}`);
    return item ? [item] : [];
  });

  const handleChange = (next: VariantItemData[] | null) => {
    const nextItems = next ?? [];
    const regular = nextItems.filter((item) => !item.kind);
    const creates = nextItems.filter((item) => item.kind === "create");
    const patch: Record<string, string> = {};

    for (const entry of registry) {
      const current = attributes?.[entry.key]?.trim() || "";
      const chosen = regular.filter((item) => item.axisKey === entry.key).map((item) => item.label);
      let nextValue = current;
      if (chosen.length === 0) nextValue = "";
      else if (chosen.length === 1) nextValue = chosen[0];
      else nextValue = chosen.find((v) => v !== current) ?? chosen[chosen.length - 1];
      const created = creates.find((item) => item.axisKey === entry.key);
      if (created) {
        nextValue = created.label;
        // New value: also persist it into the store's shared catalog.
        onPersistValue?.(entry.key, created.label);
      }
      if (nextValue !== current) patch[entry.key] = nextValue;
    }

    if (Object.keys(patch).length > 0) onApply(patch);
    if (creates.length > 0) setQuery("");
  };

  return (
    <Combobox
      items={groups}
      multiple
      autoHighlight
      value={selectedItems}
      onValueChange={handleChange}
    >
      <ComboboxChips showTrigger scrollFade className={cn(hasError && "border-destructive/60")}>
        <ComboboxValue>
          {(value: VariantItemData[]) => (
            <>
              {value.map((item) => (
                <ComboboxChip
                  key={item.value}
                  className={cn(
                    "flex h-full items-center gap-1.5 rounded-[calc(var(--radius-md)-1px)] ps-2 text-sm font-medium outline-none sm:text-xs/(--text-xs--line-height) [&_svg:not([class*='size-'])]:size-4 sm:[&_svg:not([class*='size-'])]:size-3.5",
                    AXIS_CHIP_CLASSES[item.axisIndex % AXIS_CHIP_CLASSES.length],
                  )}
                  aria-label={`${item.axisLabel} : ${item.label}`}
                >
                  {item.colorHex && <ColorSwatch colorHex={item.colorHex} />}
                  {item.label}
                </ComboboxChip>
              ))}
              <ComboboxChipsInput
                ref={inputRef}
                aria-label={ariaLabel}
                className="w-16"
                placeholder={
                  value.length === 0
                    ? registry
                        .slice(0, 3)
                        .map((entry) => entry.label)
                        .join(", ")
                    : undefined
                }
                disabled={disabled}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.preventDefault();
                }}
              />
            </>
          )}
        </ComboboxValue>
      </ComboboxChips>
      <ComboboxPopup>
        <ComboboxList>
          {(group: VariantGroupData) => (
            <ComboboxGroup key={group.value} items={group.items}>
              <ComboboxGroupLabel>
                <span
                  className={cn(
                    "inline-flex items-center rounded-md px-1.5 py-0.5 text-xs font-medium",
                    AXIS_CHIP_CLASSES[group.colorIndex % AXIS_CHIP_CLASSES.length],
                  )}
                >
                  {group.label}
                </span>
              </ComboboxGroupLabel>
              <ComboboxCollection>
                {(item: VariantItemData) =>
                  item.kind === "create" ? (
                    <ComboboxItem key={item.value} value={item}>
                      <span className="text-primary flex items-center gap-1.5 font-medium">
                        <Plus className="h-3.5 w-3.5" />
                        {createLabel(item.label, item.axisLabel)}
                      </span>
                    </ComboboxItem>
                  ) : (
                    <ComboboxItem key={item.value} value={item}>
                      <span className="flex w-full min-w-0 items-center gap-2">
                        {item.colorHex && <ColorSwatch colorHex={item.colorHex} />}
                        <span className="min-w-0 flex-1 truncate">{item.label}</span>
                      </span>
                    </ComboboxItem>
                  )
                }
              </ComboboxCollection>
            </ComboboxGroup>
          )}
        </ComboboxList>
        <div className="border-t p-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-foreground w-full justify-between"
            onClick={onManage}
          >
            <span className="flex items-center gap-1.5">
              <Settings2 className="size-4" />
              {manageLabel}
            </span>
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </ComboboxPopup>
    </Combobox>
  );
}

function UnitRow({
  unit,
  index,
  unitCount,
  bookingAttributeAxes,
  existingValuesByAxis,
  variantRegistry,
  isDuplicate,
  isEmpty,
  disabled,
  productId,
  currency,
  onUpdate,
  onUpdateAttributes,
  onPersistVariantValue,
  onManageVariants,
  onRemove,
  onTouch,
  onApplyPurchaseToAll,
}: {
  unit: ProductUnitInput;
  index: number;
  unitCount: number;
  bookingAttributeAxes: BookingAttributeAxisInput[];
  existingValuesByAxis: Record<string, string[]>;
  variantRegistry: VariantRegistryEntry[];
  isDuplicate: boolean;
  isEmpty: boolean;
  disabled: boolean;
  productId?: string;
  currency: string;
  onUpdate: (index: number, patch: Partial<ProductUnitInput>) => void;
  onUpdateAttributes: (index: number, patch: Record<string, string>) => void;
  onPersistVariantValue: (axisKey: string, label: string) => void;
  onManageVariants: () => void;
  onRemove: (index: number) => void;
  onTouch: (index: number) => void;
  onApplyPurchaseToAll: (index: number) => void;
}) {
  const t = useTranslations("dashboard.products.form.unitTracking");
  const tCommon = useTranslations("common");
  const tReservationForm = useTranslations("dashboard.reservations.manualForm");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const { uploadImage, deleteImage, isUploading } = useImageUpload("product");

  const handleImageFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const currentImages = unit.images ?? [];
    const files = Array.from(fileList).slice(0, MAX_UNIT_IMAGES - currentImages.length);
    const uploadedUrls: string[] = [];
    for (const file of files) {
      try {
        const uploaded = await uploadImage(file);
        uploadedUrls.push(uploaded.url);
      } catch {
        toastManager.add({ title: tCommon("error"), type: "error" });
      }
    }
    if (uploadedUrls.length > 0) {
      onUpdate(index, { images: [...currentImages, ...uploadedUrls] });
    }
  };

  const handleRemoveImage = (url: string) => {
    onUpdate(index, {
      images: (unit.images ?? []).filter((image) => image !== url),
    });
    // New-unit images were uploaded in this session — safe to clean up storage.
    void deleteImage(url).catch(() => {});
  };

  const missingVariantValue = bookingAttributeAxes.some(
    (axis) => !unit.attributes?.[axis.key]?.trim(),
  );
  const isExistingUnit = Boolean(unit.id);
  const hasActiveAssignment = unit.hasActiveAssignment ?? false;
  const hasPurchase =
    !!(typeof unit.purchasePrice === "string" && unit.purchasePrice.trim()) || !!unit.purchasedAt;
  const canApplyToAll = !isExistingUnit && unitCount > 1 && hasPurchase;
  const inventoryHref = productId ? `/dashboard/products/${productId}` : null;

  return (
    <div
      className={cn(
        // "rounded-lg border transition-colors",
        "border-b last:border-b-0",
        isDuplicate && "border-destructive bg-destructive/5",
      )}
    >
      <Collapsible open={detailsOpen} onOpenChange={setDetailsOpen}>
        <div className="px-3 py-2">
          {/* Line 1: dot + identifier + indicators + expand + delete */}
          <div className="flex items-center gap-2">
            {/* <span
              className={cn(
                "h-2 w-2 shrink-0 rounded-full",
                hasActiveAssignment ? "bg-amber-500" : "bg-green-500",
              )}
            /> */}
            <Input
              placeholder={t("identifierPlaceholder")}
              value={unit.identifier}
              onChange={(e) => onUpdate(index, { identifier: e.target.value })}
              onBlur={() => onTouch(index)}
              className={cn(" flex-1", (isDuplicate || isEmpty) && "border-destructive")}
              disabled={disabled}
            />
            {/* Variant values: one combobox, colored chip per axis (desktop) */}
            <div className="hidden min-w-0 flex-1 sm:block">
              <UnitVariantsCombobox
                registry={variantRegistry}
                attributes={unit.attributes}
                existingValuesByAxis={existingValuesByAxis}
                disabled={disabled}
                hasError={missingVariantValue}
                onApply={(patch) => onUpdateAttributes(index, patch)}
                onPersistValue={onPersistVariantValue}
                createLabel={(value, axis) => t("createVariantValue", { value, axis })}
                manageLabel={t("manageVariants")}
                onManage={onManageVariants}
              />
            </div>
            {hasActiveAssignment && <Badge variant="expired">{t("assignedUnit")}</Badge>}
            <CollapsibleTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="text-muted-foreground h-8 w-8 shrink-0"
                  disabled={disabled}
                  aria-label={t("unitDetails")}
                />
              }
            >
              <ChevronDown
                className={cn(
                  "h-4 w-4 transition-transform duration-200 ease-out",
                  detailsOpen && "rotate-180",
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
                      disabled={disabled || hasActiveAssignment}
                      className="text-muted-foreground hover:text-destructive h-8 w-8 shrink-0"
                    />
                  }
                >
                  <Trash2 className="h-4 w-4" />
                </TooltipTrigger>
                <TooltipContent>
                  <p>{hasActiveAssignment ? t("deleteWarning") : t("deleteConfirm")}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>

          {isEmpty && <p className="text-destructive mt-1.5 text-xs">{t("identifierRequired")}</p>}

          {/* Variant values, mobile fallback (inline combobox is hidden < sm) */}
          <div className="mt-2 sm:hidden">
            <UnitVariantsCombobox
              registry={variantRegistry}
              attributes={unit.attributes}
              existingValuesByAxis={existingValuesByAxis}
              disabled={disabled}
              hasError={missingVariantValue}
              onApply={(patch) => onUpdateAttributes(index, patch)}
              onPersistValue={onPersistVariantValue}
              createLabel={(value, axis) => t("createVariantValue", { value, axis })}
              manageLabel={t("manageVariants")}
              onManage={onManageVariants}
            />
          </div>
        </div>

        {/* Expanded details: product form only edits details for new units. */}
        <CollapsibleContent className="p-1 pt-0">
          <div className="space-y-0 rounded-lg bg-sidebar px-3 pt-3 pb-3">
            {isExistingUnit ? (
              <p className="text-muted-foreground text-sm">
                {t("existingUnitDetailsHint")}{" "}
                {inventoryHref && (
                  <Link
                    href={inventoryHref}
                    className="text-primary font-medium underline-offset-4 hover:underline"
                  >
                    {t("openInventoryDetails")}
                  </Link>
                )}
              </p>
            ) : (
              <>
                <div>
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground text-xs font-medium">
                      {t("purchaseDetails")}
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
                        {t("applyPurchaseToAll")}
                      </Button>
                    )}
                  </div>
                  <div className="mt-1.5 grid items-start gap-1 sm:grid-cols-2">
                    <InputPrice
                      value={
                        typeof unit.purchasePrice === "string"
                          ? parseFloat(unit.purchasePrice.replace(",", ".")) || 0
                          : 0
                      }
                      onValueCommitted={(price) =>
                        onUpdate(index, {
                          purchasePrice: price > 0 ? String(price) : "",
                        })
                      }
                      suffix={getCurrencySymbol(currency)}
                      ariaLabel={t("purchasePrice")}
                      disabled={disabled}
                    />
                    <ReservationDatePickerControl
                      value={toDatePickerValue(unit.purchasedAt)}
                      onChange={(date) => onUpdate(index, { purchasedAt: date ?? null })}
                      showTime={false}
                      disabled={disabled}
                      placeholder={tReservationForm("pickDate")}
                    />
                  </div>
                </div>{" "}
                <div>
                  <span className="text-muted-foreground text-xs font-medium">
                    {t("unitImages")}
                  </span>
                  <div className="mt-1.5 flex flex-wrap gap-2">
                    {(unit.images ?? []).map((url) => (
                      <div
                        key={url}
                        className="group/image relative size-16 overflow-hidden rounded-md border"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={url} alt="" className="h-full w-full object-cover" />
                        <button
                          type="button"
                          className="bg-background/80 hover:text-destructive absolute top-0.5 right-0.5 rounded-sm p-0.5 opacity-0 transition-opacity group-hover/image:opacity-100"
                          onClick={() => handleRemoveImage(url)}
                          disabled={disabled}
                          aria-label={tCommon("delete")}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                    {(unit.images?.length ?? 0) < MAX_UNIT_IMAGES && (
                      <label
                        className={cn(
                          "border-muted-foreground/25 text-muted-foreground hover:border-muted-foreground/40 hover:text-foreground flex size-16 cursor-pointer items-center justify-center rounded-md border border-dashed transition-colors",
                          (disabled || isUploading) && "pointer-events-none opacity-50",
                        )}
                      >
                        {isUploading ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <ImagePlus className="h-4 w-4" />
                        )}
                        <input
                          type="file"
                          accept={IMAGE_UPLOAD_MIME_TYPES.join(",")}
                          multiple
                          className="sr-only"
                          onChange={(e) => {
                            void handleImageFiles(e.target.files);
                            e.target.value = "";
                          }}
                          disabled={disabled || isUploading}
                        />
                      </label>
                    )}
                  </div>
                </div>
                <div>
                  <span className="text-muted-foreground text-xs font-medium">{t("notes")}</span>
                  <Textarea
                    placeholder={t("notesPlaceholder")}
                    value={unit.notes || ""}
                    onChange={(e) => onUpdate(index, { notes: e.target.value })}
                    className="mt-1.5 min-h-15 text-sm"
                    disabled={disabled}
                  />
                </div>
              </>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

interface UnitTrackingEditorProps {
  trackUnits: boolean;
  bookingAttributeAxes: BookingAttributeAxisInput[];
  onBookingAttributeAxesChange: (axes: BookingAttributeAxisInput[]) => void;
  units: ProductUnitInput[];
  onChange: (units: ProductUnitInput[]) => void;
  quantity: string;
  onQuantityChange: (value: string) => void;
  currency: string;
  defaultPrefix?: string;
  disabled?: boolean;
  showValidationErrors?: boolean;
  productId?: string;
}

const MAX_GENERATED_UNITS = 100;

function getNextSequenceNumber(units: ProductUnitInput[], prefix: string): number {
  const pattern = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}0*(\\d+)$`, "i");
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
  bookingAttributeAxes,
  onBookingAttributeAxesChange,
  units,
  onChange,
  quantity,
  onQuantityChange,
  currency,
  defaultPrefix = "",
  disabled = false,
  showValidationErrors = false,
  productId,
}: UnitTrackingEditorProps) {
  const t = useTranslations("dashboard.products.form.unitTracking");
  const tCommon = useTranslations("common");
  // The editor mounts once the stock choice is made. Arriving on unit tracking
  // with a declared quantity seeds the generator with it, instead of creating
  // empty (and invalid) unit rows.
  const declaredQuantity = parseInt(quantity, 10);
  const seedsGenerator = trackUnits && units.length === 0 && declaredQuantity > 0;
  const [genPrefix, setGenPrefix] = useState("");
  const [genCount, setGenCount] = useState(() =>
    seedsGenerator ? String(Math.min(declaredQuantity, MAX_GENERATED_UNITS)) : "5",
  );
  const [touchedUnits, setTouchedUnits] = useState<Set<number>>(new Set());
  const [newRef, setNewRef] = useState("");
  const [newRefAttributes, setNewRefAttributes] = useState<Record<string, string>>({});
  const newRefInputRef = useRef<HTMLInputElement>(null);
  const newRefVariantsInputRef = useRef<HTMLInputElement>(null);
  const [generatorOpen, setGeneratorOpen] = useState(seedsGenerator && declaredQuantity > 1);

  // Store-level shared variant catalog
  const queryClient = useQueryClient();
  const variantCatalogQuery = useQuery(orpc.dashboard.variants.list.queryOptions());
  const variantCatalog: VariantCatalogDefinition[] = variantCatalogQuery.data ?? [];
  const ensureDefinitionMutation = useMutation(
    orpc.dashboard.variants.ensureDefinition.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: orpc.dashboard.variants.key(),
        });
      },
    }),
  );
  const createValueMutation = useMutation(
    orpc.dashboard.variants.createValue.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: orpc.dashboard.variants.key(),
        });
      },
    }),
  );

  const [variantManagerOpen, setVariantManagerOpen] = useState(false);

  // System presets resolved with the current locale's labels
  const resolvedPresets = useMemo(() => resolveVariantPresets((key) => String(t.raw(key))), [t]);
  const activeBookingAttributeAxes = useMemo(
    () => filterActiveVariantAxes(bookingAttributeAxes, variantCatalog, resolvedPresets),
    [bookingAttributeAxes, resolvedPresets, variantCatalog],
  );

  // Everything selectable in the row combobox: active definitions, default
  // presets without a saved preference, and legacy product axes.
  const variantRegistry = useMemo(
    () => buildVariantRegistry(activeBookingAttributeAxes, variantCatalog, resolvedPresets),
    [activeBookingAttributeAxes, resolvedPresets, variantCatalog],
  );

  const registryByKey = useMemo(
    () => new Map(variantRegistry.map((entry) => [entry.key, entry])),
    [variantRegistry],
  );

  const ensureVariantDefinition = async (input: EnsureDefinitionInput) => {
    try {
      return await ensureDefinitionMutation.mutateAsync(input);
    } catch {
      toastManager.add({ title: tCommon("error"), type: "error" });
      return null;
    }
  };

  const adoptRegistryEntry = (entry: VariantRegistryEntry) =>
    ensureVariantDefinition({
      key: entry.catalogKey,
      label: entry.label,
      kind: entry.kind,
      values: entry.values.map((value) => ({
        label: value.label,
        colorHex: value.colorHex ?? undefined,
      })),
    });

  const persistVariantValue = async (axisKey: string, label: string) => {
    const entry = registryByKey.get(axisKey);
    if (!entry) return;
    if (entry.values.some((value) => value.label.toLowerCase() === label.toLowerCase())) return;
    let definitionId = entry.definitionId;
    if (!definitionId) {
      definitionId = (await adoptRegistryEntry(entry))?.id;
    }
    if (definitionId) createValueMutation.mutate({ definitionId, label });
  };

  const effectivePrefix = genPrefix || defaultPrefix;

  const trackedUnitsCount = units.length;

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
    for (const axis of activeBookingAttributeAxes) {
      const uniqueValues = new Set<string>();
      for (const unit of units) {
        const val = unit.attributes?.[axis.key]?.trim();
        if (val) uniqueValues.add(val);
      }
      map[axis.key] = Array.from(uniqueValues).sort();
    }
    return map;
  }, [activeBookingAttributeAxes, units]);

  const newRefVariantRegistry = variantRegistry.filter((entry) =>
    activeBookingAttributeAxes.some((axis) => axis.key === entry.key),
  );
  const newRefValuesByAxis = Object.fromEntries(
    activeBookingAttributeAxes.map((axis) => [
      axis.key,
      [...(existingValuesByAxis[axis.key] ?? []), newRefAttributes[axis.key]].filter(
        (value): value is string => Boolean(value),
      ),
    ]),
  );
  const hasRequiredVariants = activeBookingAttributeAxes.length > 0;
  const newRefHasRequiredVariants = hasCompleteAttributes(
    activeBookingAttributeAxes,
    newRefAttributes,
  );

  const missingAttributeCount = useMemo(() => {
    if (activeBookingAttributeAxes.length === 0) return 0;
    return units.filter((unit) => {
      return activeBookingAttributeAxes.some((axis) => !unit.attributes?.[axis.key]?.trim());
    }).length;
  }, [activeBookingAttributeAxes, units]);

  const generationPreview = useMemo(() => {
    const count = Math.min(parseInt(genCount, 10) || 0, MAX_GENERATED_UNITS);
    if (!effectivePrefix.trim() || count < 1) return null;
    const from = getNextSequenceNumber(units, effectivePrefix.trim());
    const to = from + count - 1;
    const padLength = Math.max(2, String(to).length);
    const first = `${effectivePrefix.trim()}${String(from).padStart(padLength, "0")}`;
    if (count === 1) return first;
    const last = `${effectivePrefix.trim()}${String(to).padStart(padLength, "0")}`;
    return `${first} … ${last}`;
  }, [effectivePrefix, genCount, units]);

  const commitNewRef = () => {
    const identifier = newRef.trim();
    if (disabled || !identifier) return;
    if (!newRefHasRequiredVariants) {
      newRefVariantsInputRef.current?.focus();
      return;
    }
    const attributes = canonicalizeAttributes(activeBookingAttributeAxes, newRefAttributes);
    onChange([
      ...units,
      {
        identifier,
        notes: "",
        purchasePrice: "",
        purchasedAt: null,
        images: [],
        attributes,
      },
    ]);
    for (const [axisKey, value] of Object.entries(attributes)) {
      void persistVariantValue(axisKey, value);
    }
    setNewRef("");
    setNewRefAttributes({});
    newRefInputRef.current?.focus();
  };

  const removeUnit = (index: number) => {
    onChange(units.filter((_, i) => i !== index));
  };

  const updateUnit = (index: number, patch: Partial<ProductUnitInput>) => {
    const newUnits = [...units];
    newUnits[index] = { ...newUnits[index], ...patch };
    onChange(newUnits);
  };

  const updateUnitAttributes = (index: number, patch: Record<string, string>) => {
    const newUnits = [...units];
    newUnits[index] = {
      ...newUnits[index],
      attributes: {
        ...newUnits[index].attributes,
        ...patch,
      },
    };
    onChange(newUnits);
  };

  const applyPurchaseToAll = (sourceIndex: number) => {
    const source = units[sourceIndex];
    if (!source) return;
    onChange(
      units.map((unit) =>
        unit.id
          ? unit
          : {
              ...unit,
              purchasePrice: source.purchasePrice,
              purchasedAt: source.purchasedAt,
            },
      ),
    );
  };

  /**
   * Applies a variant patch coming from a row combobox. Selecting a value of
   * a variant not yet on the product implicitly adds the axis (adopting the
   * preset into the catalog when needed), capped at 3 axes.
   */
  const applyVariantPatch = (index: number, patch: Record<string, string>) => {
    const nextPatch: Record<string, string> = {};
    let axes = bookingAttributeAxes;

    for (const [key, value] of Object.entries(patch)) {
      const existingAxis = findMatchingVariant(key, axes);
      if (!existingAxis) {
        if (!value) continue;
        if (axes.length >= 3) {
          toastManager.add({ title: t("variantsMaxReached"), type: "error" });
          continue;
        }
        const entry = registryByKey.get(key);
        if (!entry) continue;
        if (!entry.definitionId) {
          // Preset: adopt it into the shared catalog (idempotent).
          void adoptRegistryEntry(entry);
        }
        axes = [...axes, { key, label: entry.label, position: axes.length }];
      }
      nextPatch[existingAxis?.key ?? key] = value;
    }

    if (axes !== bookingAttributeAxes) onBookingAttributeAxesChange(axes);
    if (Object.keys(nextPatch).length > 0) updateUnitAttributes(index, nextPatch);
  };

  const removeBookingAxis = (key: string) => {
    const nextAxes = bookingAttributeAxes
      .filter((axis) => axis.key !== key)
      .map((axis, index) => ({ ...axis, position: index }));
    onBookingAttributeAxesChange(nextAxes);

    if (units.length > 0) {
      const nextUnits = units.map((unit) => {
        const attributes = { ...unit.attributes };
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
      const identifier = `${prefix}${String(i).padStart(padLength, "0")}`;
      if (!units.some((u) => u.identifier.toLowerCase() === identifier.toLowerCase())) {
        newUnits.push({
          identifier,
          notes: "",
          purchasePrice: "",
          purchasedAt: null,
          images: [],
          attributes: {},
        });
      }
    }

    if (newUnits.length > 0) {
      onChange([...units, ...newUnits]);
    }
  };

  return (
    <div className="space-y-2">
      {/* Quantity field (simple mode) */}
      {!trackUnits && (
        <div className="grid gap-2">
          <Label>{t("quantityLabel")}</Label>
          <InputQuantity
            value={parseInt(quantity, 10) || 1}
            onChange={(next) => onQuantityChange(String(next))}
            min={1}
            disabled={disabled}
            ariaLabel={t("quantityLabel")}
          />
        </div>
      )}

      {trackUnits && (
        <>
          {/* Units header: title + count, variant tools on the right */}
          <div className="flex flex-wrap items-center gap-2">
            <Label>{t("title")}</Label>
            <Badge variant="expired" className="border">
              {trackedUnitsCount}
            </Badge>
            <div className="ml-auto flex items-center gap-2">
              <Button
                type="button"
                variant="tertiary"
                onClick={() => setVariantManagerOpen(true)}
                disabled={disabled}
              >
                <Settings2 data-slot="icon" />
                {t("manageVariants")}
              </Button>
            </div>
          </div>

          {/* Declared variants, colored to match the chips on unit rows */}
          {activeBookingAttributeAxes.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-muted-foreground text-xs">{t("variantsTitle")} :</span>
              {activeBookingAttributeAxes.map((axis) => (
                <Badge
                  key={axis.key}
                  variant={
                    AXIS_BADGE_VARIANTS[
                      (registryByKey.get(axis.key)?.colorIndex ?? 0) % AXIS_BADGE_VARIANTS.length
                    ]
                  }
                  className="gap-1 pr-1"
                >
                  {axis.label}
                  <button
                    type="button"
                    className="rounded-sm px-0.5 hover:bg-black/10 dark:hover:bg-white/10"
                    onClick={() => removeBookingAxis(axis.key)}
                    disabled={disabled}
                    aria-label={`${t("variantsTitle")} — ${axis.label} ×`}
                  >
                    &times;
                  </button>
                </Badge>
              ))}
            </div>
          )}

          {/* Unit rows */}
          {units.length === 0 ? (
            <p className="text-muted-foreground text-sm">{/* {t("noUnitsHint")} */}</p>
          ) : (
            <div className="space-y-1 bg-background shadow-[0_0_0_1px_var(--color-border)] rounded-lg">
              {units.map((unit, index) => {
                const isDuplicate =
                  unit.identifier.trim() &&
                  duplicateIdentifiers.has(unit.identifier.trim().toLowerCase());
                const isEmpty =
                  (touchedUnits.has(index) || showValidationErrors) && !unit.identifier.trim();

                return (
                  <UnitRow
                    key={unit.id || `new-${index}`}
                    unit={unit}
                    index={index}
                    unitCount={units.length}
                    bookingAttributeAxes={activeBookingAttributeAxes}
                    existingValuesByAxis={existingValuesByAxis}
                    variantRegistry={variantRegistry}
                    isDuplicate={!!isDuplicate}
                    isEmpty={isEmpty}
                    disabled={disabled}
                    productId={productId}
                    currency={currency}
                    onUpdate={updateUnit}
                    onUpdateAttributes={applyVariantPatch}
                    onPersistVariantValue={persistVariantValue}
                    onManageVariants={() => setVariantManagerOpen(true)}
                    onRemove={removeUnit}
                    onTouch={(i) => setTouchedUnits((prev) => new Set(prev).add(i))}
                    onApplyPurchaseToAll={applyPurchaseToAll}
                  />
                );
              })}
            </div>
          )}

          <Separator className="my-2" />

          {/* Add refs one by one (primary) or generate a series (secondary, collapsed) */}
          <Collapsible open={generatorOpen} onOpenChange={setGeneratorOpen} className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <div
                className={cn(
                  "flex min-w-0 flex-1 basis-full items-center sm:basis-0",
                  hasRequiredVariants && "flex-wrap gap-2",
                )}
              >
                <Input
                  ref={newRefInputRef}
                  aria-label={t("identifier")}
                  value={newRef}
                  onChange={(e) => setNewRef(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      commitNewRef();
                    }
                  }}
                  placeholder={t("addRefPlaceholder")}
                  disabled={disabled}
                  className={cn(
                    "h-9 min-w-44 flex-1",
                    hasRequiredVariants ? "basis-full sm:basis-0" : "rounded-r-none",
                  )}
                />
                {hasRequiredVariants && (
                  <div className="min-w-0 flex-1">
                    <UnitVariantsCombobox
                      registry={newRefVariantRegistry}
                      attributes={newRefAttributes}
                      existingValuesByAxis={newRefValuesByAxis}
                      disabled={disabled}
                      hasError={false}
                      inputRef={newRefVariantsInputRef}
                      ariaLabel={`${t("addUnit")} — ${t("variantsTitle")}`}
                      onApply={(patch) =>
                        setNewRefAttributes((current) => ({ ...current, ...patch }))
                      }
                      createLabel={(value, axis) => t("createVariantValue", { value, axis })}
                      manageLabel={t("manageVariants")}
                      onManage={() => setVariantManagerOpen(true)}
                    />
                  </div>
                )}
                <Button
                  type="button"
                  className={cn("shrink-0", !hasRequiredVariants && "rounded-l-none border-l-0")}
                  variant="outline"
                  onClick={commitNewRef}
                  disabled={disabled || !newRef.trim() || !newRefHasRequiredVariants}
                >
                  <Plus data-slot="icon" className="size-4" />
                  {t("addUnit")}
                </Button>
              </div>
              <Separator orientation="vertical" className="hidden h-6 sm:block" />
              <CollapsibleTrigger render={<Button variant="outline" disabled={disabled} />}>
                {t("generateSeries")}
                <ChevronDown
                  data-slot="icon"
                  className={cn(
                    "transition-transform duration-200 ease-out",
                    generatorOpen && "rotate-180",
                  )}
                />
              </CollapsibleTrigger>
            </div>
            <CollapsibleContent>
              <div className="bg-muted/40 rounded-lg border p-3">
                <div className="flex flex-wrap items-end gap-2">
                  <div className="min-w-30 flex-1 ">
                    <Label className="text-muted-foreground text-xs">{t("bulkPrefix")}</Label>
                    <Input
                      placeholder={defaultPrefix || t("bulkPrefixPlaceholder")}
                      value={genPrefix}
                      onChange={(e) => setGenPrefix(e.target.value)}
                      disabled={disabled}
                    />
                  </div>
                  <div className="">
                    <Label className="text-muted-foreground text-xs">{t("generatorCount")}</Label>
                    <InputQuantity
                      value={parseInt(genCount, 10) || 1}
                      onChange={(next) => setGenCount(String(next))}
                      min={1}
                      max={MAX_GENERATED_UNITS}
                      disabled={disabled}
                      ariaLabel={t("generatorCount")}
                    />
                  </div>
                  <Button onClick={handleGenerate} disabled={disabled || !effectivePrefix.trim()}>
                    {t("bulkGenerate")}
                  </Button>
                </div>
                <p className="text-muted-foreground mt-2 text-xs">
                  {generationPreview
                    ? `${t("bulkPreview")} : ${generationPreview}`
                    : t("generatorHint")}
                </p>
              </div>
            </CollapsibleContent>
          </Collapsible>

          {/* Warnings */}
          {duplicateIdentifiers.size > 0 && (
            <div className="bg-destructive/10 text-destructive flex items-center gap-2 rounded-md p-3 text-sm">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>{t("duplicateIdentifier")}</span>
            </div>
          )}

          {missingAttributeCount > 0 && (
            <div className="bg-destructive/10 text-destructive flex items-center gap-2 rounded-md p-3 text-sm">
              <AlertCircle className="h-4 w-4 shrink-0" />
              <span>
                {t("missingAttributesWarning", {
                  count: missingAttributeCount,
                })}
              </span>
            </div>
          )}
        </>
      )}

      {/* Shared variant catalog manager */}
      <VariantManagerDrawer open={variantManagerOpen} onOpenChange={setVariantManagerOpen} />
    </div>
  );
}
