'use client';

import { useMemo, useState } from 'react';

import { Pencil, RefreshCw, Search } from 'lucide-react';
import { useTranslations } from 'next-intl';

import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
} from '@louez/ui';
import {
  Combobox,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
} from '@louez/ui';
import {
  Sheet,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetPanel,
  SheetPopup,
  SheetTitle,
} from '@louez/ui';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@louez/ui';
import { cn } from '@louez/utils';

type TulipProductType = (typeof TULIP_PRODUCT_TYPES)[number];
type TulipProductSubtype = (typeof TULIP_PRODUCT_SUBTYPES)[number];

type ProductActionInput = {
  productId: string;
  title: string | null;
  brand: string | null;
  model: string | null;
  valueExcl: number | null;
  productType: TulipProductType | null;
  productSubtype: TulipProductSubtype | null;
  purchasedDate: string | null;
};

const TULIP_PRODUCT_TYPES = [
  'bike',
  'wintersports',
  'watersports',
  'event',
  'high-tech',
  'small-tools',
] as const;

const TULIP_PRODUCT_SUBTYPES = [
  'standard',
  'electric',
  'cargo',
  'remorque',
  'furniture',
  'tent',
  'decorations',
  'tableware',
  'entertainment',
  'action-cam',
  'drone',
  'camera',
  'video-camera',
  'stabilizer',
  'phone',
  'computer',
  'tablet',
  'small-appliance',
  'large-appliance',
  'construction-equipment',
  'diy-tools',
  'electric-diy-tools',
  'gardening-tools',
  'electric-gardening-tools',
  'kitesurf',
  'foil',
  'windsurf',
  'sailboat',
  'kayak',
  'canoe',
  'water-ski',
  'wakeboard',
  'mono-ski',
  'buoy',
  'paddle',
  'surf',
  'pedalo',
  'ski',
  'snowboard',
  'snowshoe',
] as const;

const TULIP_SUBTYPES_BY_TYPE: Record<
  TulipProductType,
  readonly TulipProductSubtype[]
> = {
  bike: ['standard', 'electric', 'cargo', 'remorque'],
  wintersports: ['ski', 'snowboard', 'snowshoe'],
  watersports: [
    'kitesurf',
    'foil',
    'windsurf',
    'sailboat',
    'kayak',
    'canoe',
    'water-ski',
    'wakeboard',
    'mono-ski',
    'buoy',
    'paddle',
    'surf',
    'pedalo',
  ],
  event: ['furniture', 'tent', 'decorations', 'tableware', 'entertainment'],
  'high-tech': [
    'action-cam',
    'drone',
    'camera',
    'video-camera',
    'stabilizer',
    'phone',
    'computer',
    'tablet',
  ],
  'small-tools': [
    'small-appliance',
    'large-appliance',
    'construction-equipment',
    'diy-tools',
    'electric-diy-tools',
    'gardening-tools',
    'electric-gardening-tools',
  ],
};

function getSubtypeOptionsForType(
  productType: TulipProductType,
): readonly TulipProductSubtype[] {
  return TULIP_SUBTYPES_BY_TYPE[productType];
}

function normalizeTulipProductType(
  value: string | null | undefined,
): TulipProductType {
  if (value && (TULIP_PRODUCT_TYPES as readonly string[]).includes(value)) {
    return value as TulipProductType;
  }

  return 'event';
}

function normalizeTulipProductSubtype(
  value: string | null | undefined,
  productType: TulipProductType,
): TulipProductSubtype {
  const allowedSubtypes = getSubtypeOptionsForType(productType);
  if (
    value &&
    (allowedSubtypes as readonly string[]).includes(value)
  ) {
    return value as TulipProductSubtype;
  }

  return allowedSubtypes[0] ?? 'standard';
}

interface TulipProductMappingSectionProps {
  disabled: boolean;
  products: Array<{
    id: string;
    name: string;
    price: number;
    tulipProductId: string | null;
  }>;
  tulipProducts: Array<{
    id: string;
    title: string;
    valueExcl: number | null;
    brand: string | null;
    model: string | null;
    productType: string | null;
    productSubtype: string | null;
    purchasedDate: string | null;
  }>;
  isMappingPending: boolean;
  mappingProductId: string | null;
  isPushPending: boolean;
  pushProductId: string | null;
  isCreatePending: boolean;
  createProductId: string | null;
  isRefreshing: boolean;
  onMappingChange: (
    productId: string,
    tulipProductId: string | null,
  ) => Promise<void>;
  onPushProduct: (input: ProductActionInput) => Promise<void>;
  onCreateProduct: (input: ProductActionInput) => Promise<void>;
  onRefresh: () => Promise<void>;
}

type SheetDraft = {
  title: string;
  brand: string;
  model: string;
  valueExcl: string;
  productType: TulipProductType;
  productSubtype: TulipProductSubtype;
  purchasedDate: string;
};

type ComboboxOption = {
  label: string;
  value: string;
  kind?: 'existing' | 'create';
};

function toUniqueSortedOptions(
  values: Array<string | null | undefined>,
): ComboboxOption[] {
  return Array.from(
    new Set(
      values
        .map((value) => value?.trim())
        .filter((value): value is string => Boolean(value)),
    ),
  )
    .sort((a, b) => a.localeCompare(b))
    .map((value) => ({ label: value, value, kind: 'existing' as const }));
}

export function TulipProductMappingSection({
  disabled,
  products,
  tulipProducts,
  isMappingPending,
  mappingProductId,
  isPushPending,
  pushProductId,
  isCreatePending,
  createProductId,
  isRefreshing,
  onMappingChange,
  onPushProduct,
  onCreateProduct,
  onRefresh,
}: TulipProductMappingSectionProps) {
  const t = useTranslations(
    'dashboard.settings.integrationsPage.assurance.mapping',
  );

  // Filter state
  const [statusFilter, setStatusFilter] = useState<
    'all' | 'mapped' | 'unmapped'
  >('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Sheet state
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const [sheetDraft, setSheetDraft] = useState<SheetDraft | null>(null);
  const [brandInputValue, setBrandInputValue] = useState('');
  const [modelInputValue, setModelInputValue] = useState('');

  const tulipItems = useMemo(
    () => tulipProducts.map((tp) => ({ label: tp.title, value: tp.id })),
    [tulipProducts],
  );
  const tulipProductById = useMemo(
    () => new Map(tulipProducts.map((tp) => [tp.id, tp] as const)),
    [tulipProducts],
  );
  const hasValidMapping = (tulipProductId: string | null): boolean =>
    Boolean(tulipProductId && tulipProductById.has(tulipProductId));
  const categoryItems = TULIP_PRODUCT_TYPES.map((v) => ({ label: v, value: v }));
  const subtypeItems = useMemo(
    () =>
      getSubtypeOptionsForType(sheetDraft?.productType ?? 'event').map((v) => ({
        label: v,
        value: v,
      })),
    [sheetDraft?.productType],
  );
  const knownBrandItems = useMemo(
    () => toUniqueSortedOptions(tulipProducts.map((tp) => tp.brand)),
    [tulipProducts],
  );
  const knownModelItems = useMemo(() => {
    const selectedBrand = sheetDraft?.brand.trim().toLowerCase();
    const sourceProducts = selectedBrand
      ? tulipProducts.filter(
          (tp) => tp.brand?.trim().toLowerCase() === selectedBrand,
        )
      : tulipProducts;

    return toUniqueSortedOptions(sourceProducts.map((tp) => tp.model));
  }, [sheetDraft?.brand, tulipProducts]);
  const brandItems = useMemo(() => {
    const customValue = brandInputValue.trim();
    if (!customValue) {
      return knownBrandItems;
    }

    if (
      knownBrandItems.some(
        (item) => item.value.toLowerCase() === customValue.toLowerCase(),
      )
    ) {
      return knownBrandItems;
    }

    return [
      { label: customValue, value: customValue, kind: 'create' as const },
      ...knownBrandItems,
    ];
  }, [brandInputValue, knownBrandItems]);
  const modelItems = useMemo(() => {
    const customValue = modelInputValue.trim();
    if (!customValue) {
      return knownModelItems;
    }

    if (
      knownModelItems.some(
        (item) => item.value.toLowerCase() === customValue.toLowerCase(),
      )
    ) {
      return knownModelItems;
    }

    return [
      { label: customValue, value: customValue, kind: 'create' as const },
      ...knownModelItems,
    ];
  }, [knownModelItems, modelInputValue]);

  const filteredProducts = useMemo(() => {
    let filtered = products;
    if (statusFilter === 'mapped')
      filtered = filtered.filter((p) => hasValidMapping(p.tulipProductId));
    else if (statusFilter === 'unmapped')
      filtered = filtered.filter((p) => !hasValidMapping(p.tulipProductId));
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter((p) => p.name.toLowerCase().includes(q));
    }
    return filtered;
  }, [products, statusFilter, searchQuery, tulipProductById]);

  const statusCounts = useMemo(
    () => ({
      all: products.length,
      mapped: products.filter((p) => hasValidMapping(p.tulipProductId)).length,
      unmapped: products.filter((p) => !hasValidMapping(p.tulipProductId))
        .length,
    }),
    [products, tulipProductById],
  );

  const editingProduct = editingProductId
    ? (products.find((p) => p.id === editingProductId) ?? null)
    : null;
  const editingProductHasValidMapping = hasValidMapping(
    editingProduct?.tulipProductId ?? null,
  );
  const editingTulipProduct = editingProduct
    ? (editingProduct.tulipProductId
        ? (tulipProductById.get(editingProduct.tulipProductId) ?? null)
        : null)
    : null;

  // Sheet draft validation
  const normalizedValueExcl =
    sheetDraft?.valueExcl.trim().replace(',', '.') ?? '';
  const parsedValueExcl =
    normalizedValueExcl.length === 0 ? null : Number(normalizedValueExcl);
  const hasInvalidValueExcl =
    normalizedValueExcl.length > 0 && !Number.isFinite(parsedValueExcl);
  const hasInvalidPurchasedDate = sheetDraft?.purchasedDate
    ? Number.isNaN(
        new Date(`${sheetDraft.purchasedDate}T00:00:00.000Z`).getTime(),
      )
    : false;
  const disableSaveButton =
    disabled ||
    isRefreshing ||
    !sheetDraft ||
    hasInvalidValueExcl ||
    hasInvalidPurchasedDate ||
    isPushPending ||
    isCreatePending;

  const handleEditClick = (productId: string) => {
    const product = products.find((p) => p.id === productId);
    if (!product) return;
    const tp = tulipProducts.find((t) => t.id === product.tulipProductId);
    const resolvedProductType = normalizeTulipProductType(tp?.productType);
    setSheetDraft({
      title: '',
      productType: resolvedProductType,
      productSubtype: normalizeTulipProductSubtype(
        tp?.productSubtype,
        resolvedProductType,
      ),
      brand: tp?.brand ?? '',
      model: tp?.model ?? '',
      purchasedDate: tp?.purchasedDate ? tp.purchasedDate.slice(0, 10) : '',
      valueExcl:
        tp?.valueExcl != null
          ? tp.valueExcl.toFixed(2)
          : product.price.toFixed(2),
    });
    setBrandInputValue(tp?.brand ?? '');
    setModelInputValue(tp?.model ?? '');
    setEditingProductId(productId);
    setSheetOpen(true);
  };

  const handleSheetSave = async () => {
    if (!editingProduct || !sheetDraft) return;
    const normalized = sheetDraft.valueExcl.trim().replace(',', '.');
    const parsed = normalized.length === 0 ? null : Number(normalized);
    const input: ProductActionInput = {
      productId: editingProduct.id,
      title: sheetDraft.title.trim() || null,
      productType: sheetDraft.productType,
      productSubtype: sheetDraft.productSubtype,
      brand: sheetDraft.brand.trim() || null,
      model: sheetDraft.model.trim() || null,
      purchasedDate: sheetDraft.purchasedDate
        ? new Date(`${sheetDraft.purchasedDate}T00:00:00.000Z`).toISOString()
        : null,
      valueExcl: Number.isFinite(parsed) ? parsed : null,
    };
    if (editingProductHasValidMapping) {
      await onPushProduct(input);
    } else {
      await onCreateProduct(input);
    }
    setSheetOpen(false);
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-4">
          <div className="space-y-1">
            <CardTitle>{t('title')}</CardTitle>
            <CardDescription>{t('description')}</CardDescription>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void onRefresh()}
            disabled={disabled || isRefreshing}
          >
            <RefreshCw
              className={cn('h-4 w-4', isRefreshing && 'animate-spin')}
            />
            {isRefreshing ? t('refreshingButton') : t('refreshButton')}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {disabled && (
          <p className="text-muted-foreground rounded-md border border-dashed p-3 text-sm">
            {t('disabledMessage')}
          </p>
        )}

        {/* Filter bar */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="bg-muted/50 flex items-center gap-1 rounded-lg border p-1">
            {(['all', 'mapped', 'unmapped'] as const).map((status) => (
              <Button
                key={status}
                type="button"
                variant={statusFilter === status ? 'secondary' : 'ghost'}
                size="sm"
                onClick={() => setStatusFilter(status)}
              >
                {t(`filters.${status}`)}
                <Badge
                  variant={statusFilter === status ? 'default' : 'secondary'}
                  className="ml-1.5 h-5 min-w-5 px-1.5"
                  size="sm"
                >
                  {statusCounts[status]}
                </Badge>
              </Button>
            ))}
          </div>
          <div className="relative">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
            <Input
              placeholder={t('searchPlaceholder')}
              className="w-full pl-9 sm:w-[250px]"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>

        {/* Product table */}
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('columns.product')}</TableHead>
                <TableHead>{t('columns.tulipProduct')}</TableHead>
                <TableHead>{t('statusBadge.label')}</TableHead>
                <TableHead className="w-[80px] text-right">
                  {t('columns.actions')}
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {products.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={4}
                    className="text-muted-foreground py-8 text-center"
                  >
                    {t('emptyState')}
                  </TableCell>
                </TableRow>
              )}

              {products.length > 0 && filteredProducts.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={4}
                    className="text-muted-foreground py-8 text-center"
                  >
                    {t('noFilterResults')}
                  </TableCell>
                </TableRow>
              )}

              {filteredProducts.map((product) => (
                <TableRow key={product.id}>
                  <TableCell className="font-medium">{product.name}</TableCell>
                  <TableCell>
                    {(() => {
                      const hasMappedStatus = hasValidMapping(
                        product.tulipProductId,
                      );
                      const selectedTulipItem = hasMappedStatus
                        ? (tulipItems.find(
                            (i) => i.value === product.tulipProductId,
                          ) ?? null)
                        : null;

                      return (
                        <div className="min-w-[220px]">
                          <Combobox
                            items={tulipItems}
                            value={selectedTulipItem}
                            onValueChange={(item) => {
                              void onMappingChange(
                                product.id,
                                item?.value ?? null,
                              );
                            }}
                          >
                            <ComboboxInput
                              showTrigger
                              showClear={!!product.tulipProductId}
                              placeholder={t('notMapped')}
                              size="sm"
                              disabled={
                                disabled ||
                                isMappingPending ||
                                isRefreshing ||
                                tulipProducts.length === 0
                              }
                            />
                            <ComboboxPopup>
                              <ComboboxEmpty>{t('noResults')}</ComboboxEmpty>
                              <ComboboxList>
                                {(item) => (
                                  <ComboboxItem
                                    key={item.value}
                                    value={item}
                                  >
                                    {item.label}
                                  </ComboboxItem>
                                )}
                              </ComboboxList>
                            </ComboboxPopup>
                          </Combobox>
                          {isMappingPending && mappingProductId === product.id && (
                            <p className="text-muted-foreground mt-1 text-xs">
                              {t('savingMapping')}
                            </p>
                          )}
                        </div>
                      );
                    })()}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        hasValidMapping(product.tulipProductId)
                          ? 'success'
                          : 'secondary'
                      }
                      size="sm"
                    >
                      {hasValidMapping(product.tulipProductId)
                        ? t('statusBadge.mapped')
                        : t('statusBadge.notMapped')}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => handleEditClick(product.id)}
                      disabled={disabled || isRefreshing}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        {/* Edit sheet */}
        <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
          <SheetPopup side="right">
            <SheetHeader>
              <SheetTitle>{editingProduct?.name}</SheetTitle>
              <SheetDescription>{t('sheet.description')}</SheetDescription>
            </SheetHeader>
            <SheetPanel>
              {editingProduct && sheetDraft && (
                <div className="space-y-4">
                  {/* Current mapping status */}
                  <div className="flex items-center gap-2">
                    <Badge
                      variant={
                        editingProductHasValidMapping
                          ? 'success'
                          : 'secondary'
                      }
                      size="sm"
                    >
                      {editingProductHasValidMapping
                        ? t('statusBadge.mapped')
                        : t('statusBadge.notMapped')}
                    </Badge>
                    {editingProductHasValidMapping && editingTulipProduct && (
                      <span className="text-muted-foreground text-sm">
                        &rarr; {editingTulipProduct.title}
                      </span>
                    )}
                  </div>

                  {/* Category */}
                  <div className="space-y-2">
                    <Label>{t('fields.productTitle')}</Label>
                    <Input
                      value={sheetDraft.title}
                      placeholder={t('productTitlePlaceholder', {
                        defaultTitle: editingTulipProduct?.title || editingProduct.name,
                      })}
                      onChange={(e) =>
                        setSheetDraft((prev) =>
                          prev ? { ...prev, title: e.target.value } : prev,
                        )
                      }
                      disabled={disabled || isRefreshing}
                    />
                  </div>

                  {/* Category */}
                  <div className="space-y-2">
                    <Label>{t('fields.category')}</Label>
                    <Combobox
                      items={categoryItems}
                      value={
                        categoryItems.find(
                          (i) => i.value === sheetDraft.productType,
                        ) ?? null
                      }
                      onValueChange={(item) => {
                        if (!item) return;
                        setSheetDraft((prev) =>
                          prev
                            ? {
                                ...prev,
                                productType: item.value as TulipProductType,
                                productSubtype: normalizeTulipProductSubtype(
                                  prev.productSubtype,
                                  item.value as TulipProductType,
                                ),
                              }
                            : prev,
                        );
                      }}
                    >
                      <ComboboxInput
                        showTrigger
                        placeholder={t('categoryPlaceholder')}
                        disabled={disabled || isRefreshing}
                      />
                      <ComboboxPopup>
                        <ComboboxEmpty>{t('noResults')}</ComboboxEmpty>
                        <ComboboxList>
                          {(item) => (
                            <ComboboxItem key={item.value} value={item}>
                              {item.label}
                            </ComboboxItem>
                          )}
                        </ComboboxList>
                      </ComboboxPopup>
                    </Combobox>
                  </div>

                  {/* Subtype */}
                  <div className="space-y-2">
                    <Label>{t('fields.productSubtype')}</Label>
                    <Combobox
                      items={subtypeItems}
                      value={
                        subtypeItems.find(
                          (i) => i.value === sheetDraft.productSubtype,
                        ) ?? null
                      }
                      onValueChange={(item) => {
                        if (!item) return;
                        setSheetDraft((prev) =>
                          prev
                            ? {
                                ...prev,
                                productSubtype:
                                  item.value as TulipProductSubtype,
                              }
                            : prev,
                        );
                      }}
                    >
                      <ComboboxInput
                        showTrigger
                        placeholder={t('productSubtypePlaceholder')}
                        disabled={disabled || isRefreshing}
                      />
                      <ComboboxPopup>
                        <ComboboxEmpty>{t('noResults')}</ComboboxEmpty>
                        <ComboboxList>
                          {(item) => (
                            <ComboboxItem key={item.value} value={item}>
                              {item.label}
                            </ComboboxItem>
                          )}
                        </ComboboxList>
                      </ComboboxPopup>
                    </Combobox>
                  </div>

                  {/* Brand */}
                  <div className="space-y-2">
                    <Label>{t('fields.brand')}</Label>
                    <Combobox
                      items={brandItems}
                      value={
                        brandItems.find(
                          (item) =>
                            item.value.toLowerCase() ===
                            sheetDraft.brand.trim().toLowerCase(),
                        ) ?? null
                      }
                      inputValue={brandInputValue}
                      onInputValueChange={(value) => {
                        if (value === undefined) return;
                        const nextValue = value;
                        setBrandInputValue(nextValue);
                        setSheetDraft((prev) =>
                          prev ? { ...prev, brand: nextValue } : prev,
                        );
                      }}
                      onValueChange={(item) => {
                        if (!item) return;
                        const nextValue = item.value;
                        setBrandInputValue(nextValue);
                        setSheetDraft((prev) =>
                          prev ? { ...prev, brand: nextValue } : prev,
                        );
                      }}
                    >
                      <ComboboxInput
                        showTrigger
                        placeholder={t('brandPlaceholder')}
                        disabled={disabled || isRefreshing}
                        onKeyDown={(event) => {
                          if (event.key !== 'Enter') return;
                          event.preventDefault();
                          const nextValue = brandInputValue.trim();
                          setBrandInputValue(nextValue);
                          setSheetDraft((prev) =>
                            prev ? { ...prev, brand: nextValue } : prev,
                          );
                          event.currentTarget.blur();
                        }}
                        onBlur={() => {
                          const nextValue = brandInputValue.trim();
                          setBrandInputValue(nextValue);
                          setSheetDraft((prev) =>
                            prev ? { ...prev, brand: nextValue } : prev,
                          );
                        }}
                      />
                      <ComboboxPopup>
                        <ComboboxEmpty>{t('noBrandResults')}</ComboboxEmpty>
                        <ComboboxList>
                          {(item) => (
                            <ComboboxItem key={item.value} value={item}>
                              {item.kind === 'create'
                                ? t('createOption', { value: item.value })
                                : item.label}
                            </ComboboxItem>
                          )}
                        </ComboboxList>
                      </ComboboxPopup>
                    </Combobox>
                  </div>

                  {/* Model */}
                  <div className="space-y-2">
                    <Label>{t('fields.model')}</Label>
                    <Combobox
                      items={modelItems}
                      value={
                        modelItems.find(
                          (item) =>
                            item.value.toLowerCase() ===
                            sheetDraft.model.trim().toLowerCase(),
                        ) ?? null
                      }
                      inputValue={modelInputValue}
                      onInputValueChange={(value) => {
                        if (value === undefined) return;
                        const nextValue = value;
                        setModelInputValue(nextValue);
                        setSheetDraft((prev) =>
                          prev ? { ...prev, model: nextValue } : prev,
                        );
                      }}
                      onValueChange={(item) => {
                        if (!item) return;
                        const nextValue = item.value;
                        setModelInputValue(nextValue);
                        setSheetDraft((prev) =>
                          prev ? { ...prev, model: nextValue } : prev,
                        );
                      }}
                    >
                      <ComboboxInput
                        showTrigger
                        placeholder={t('modelPlaceholder')}
                        disabled={disabled || isRefreshing}
                        onKeyDown={(event) => {
                          if (event.key !== 'Enter') return;
                          event.preventDefault();
                          const nextValue = modelInputValue.trim();
                          setModelInputValue(nextValue);
                          setSheetDraft((prev) =>
                            prev ? { ...prev, model: nextValue } : prev,
                          );
                          event.currentTarget.blur();
                        }}
                        onBlur={() => {
                          const nextValue = modelInputValue.trim();
                          setModelInputValue(nextValue);
                          setSheetDraft((prev) =>
                            prev ? { ...prev, model: nextValue } : prev,
                          );
                        }}
                      />
                      <ComboboxPopup>
                        <ComboboxEmpty>{t('noModelResults')}</ComboboxEmpty>
                        <ComboboxList>
                          {(item) => (
                            <ComboboxItem key={item.value} value={item}>
                              {item.kind === 'create'
                                ? t('createOption', { value: item.value })
                                : item.label}
                            </ComboboxItem>
                          )}
                        </ComboboxList>
                      </ComboboxPopup>
                    </Combobox>
                  </div>

                  {/* Purchase price */}
                  <div className="space-y-2">
                    <Label>{t('fields.purchasedDate')}</Label>
                    <Input
                      type="date"
                      value={sheetDraft.purchasedDate}
                      onChange={(e) =>
                        setSheetDraft((prev) =>
                          prev
                            ? { ...prev, purchasedDate: e.target.value }
                            : prev,
                        )
                      }
                      disabled={disabled || isRefreshing}
                    />
                    {hasInvalidPurchasedDate && (
                      <p className="text-destructive text-xs">
                        {t('invalidPurchasedDate')}
                      </p>
                    )}
                  </div>

                  {/* Purchase price */}
                  <div className="space-y-2">
                    <Label>{t('fields.purchasePriceHt')}</Label>
                    <Input
                      value={sheetDraft.valueExcl}
                      placeholder={editingProduct.price.toFixed(2)}
                      onChange={(e) =>
                        setSheetDraft((prev) =>
                          prev ? { ...prev, valueExcl: e.target.value } : prev,
                        )
                      }
                      disabled={disabled || isRefreshing}
                    />
                    {hasInvalidValueExcl && (
                      <p className="text-destructive text-xs">
                        {t('invalidPurchasePrice')}
                      </p>
                    )}
                  </div>
                </div>
              )}
            </SheetPanel>
            <SheetFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setSheetOpen(false)}
              >
                {t('sheet.cancel')}
              </Button>
              <Button
                type="button"
                onClick={() => void handleSheetSave()}
                disabled={disableSaveButton}
              >
                {editingProductHasValidMapping
                  ? isPushPending && pushProductId === editingProductId
                    ? t('updatingButton')
                    : t('updateButton')
                  : isCreatePending && createProductId === editingProductId
                    ? t('creatingButton')
                    : t('createButton')}
              </Button>
            </SheetFooter>
          </SheetPopup>
        </Sheet>
      </CardContent>
    </Card>
  );
}
