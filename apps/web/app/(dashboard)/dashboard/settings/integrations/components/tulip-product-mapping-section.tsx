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

import type {
  TulipCatalogItem,
  TulipProductDraft,
} from '@/lib/integrations/tulip/product-form-utils';
import {
  buildActionInput,
  initDraftFromTulipProduct,
  resolveTulipCatalog,
  validateDraft,
} from '@/lib/integrations/tulip/product-form-utils';

import { TulipProductFormFields } from '../../../products/components/tulip-product-form-fields';

interface TulipProductMappingSectionProps {
  disabled: boolean;
  supportsMargin: boolean;
  products: Array<{
    id: string;
    name: string;
    price: number;
    tulipProductId: string | null;
  }>;
  tulipCatalog: TulipCatalogItem[];
  tulipProducts: Array<{
    id: string;
    title: string;
    louezManaged: boolean;
    margin: number | null;
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
  onPushProduct: (input: ReturnType<typeof buildActionInput>) => Promise<void>;
  onCreateProduct: (input: ReturnType<typeof buildActionInput>) => Promise<void>;
  onRefresh: () => Promise<void>;
}

export function TulipProductMappingSection({
  disabled,
  supportsMargin,
  products,
  tulipCatalog,
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
  const [sheetDraft, setSheetDraft] = useState<TulipProductDraft | null>(null);

  const resolvedCatalog = useMemo(
    () => resolveTulipCatalog(tulipCatalog),
    [tulipCatalog],
  );
  const tulipItems = useMemo(
    () =>
      tulipProducts.map((tp) => ({
        label: tp.louezManaged ? `${tp.title} (Louez)` : tp.title,
        value: tp.id,
      })),
    [tulipProducts],
  );
  const tulipProductById = useMemo(
    () => new Map(tulipProducts.map((tp) => [tp.id, tp] as const)),
    [tulipProducts],
  );
  const hasValidMapping = (tulipProductId: string | null): boolean =>
    Boolean(tulipProductId && tulipProductById.has(tulipProductId));

  let filteredProducts = products;
  if (statusFilter === 'mapped') {
    filteredProducts = filteredProducts.filter((p) =>
      hasValidMapping(p.tulipProductId),
    );
  } else if (statusFilter === 'unmapped') {
    filteredProducts = filteredProducts.filter(
      (p) => !hasValidMapping(p.tulipProductId),
    );
  }
  if (searchQuery.trim()) {
    const q = searchQuery.toLowerCase();
    filteredProducts = filteredProducts.filter((p) =>
      p.name.toLowerCase().includes(q),
    );
  }

  const statusCounts = {
    all: products.length,
    mapped: products.filter((p) => hasValidMapping(p.tulipProductId)).length,
    unmapped: products.filter((p) => !hasValidMapping(p.tulipProductId)).length,
  };

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

  const validation = validateDraft(sheetDraft);
  const disableSaveButton =
    disabled ||
    isRefreshing ||
    !sheetDraft ||
    validation.hasMissingProductType ||
    validation.hasMissingSubtype ||
    validation.hasInvalidValueExcl ||
    validation.hasInvalidMargin ||
    validation.hasInvalidPurchasedDate ||
    isPushPending ||
    isCreatePending;

  const handleEditClick = (productId: string) => {
    const product = products.find((p) => p.id === productId);
    if (!product) return;
    const tp = product.tulipProductId
      ? (tulipProductById.get(product.tulipProductId) ?? null)
      : null;

    setSheetDraft(initDraftFromTulipProduct(resolvedCatalog, tp, product.price));
    setEditingProductId(productId);
    setSheetOpen(true);
  };

  const handleSheetSave = async () => {
    if (!editingProduct || !sheetDraft) return;
    const input = buildActionInput(editingProduct.id, sheetDraft);

    if (editingProductHasValidMapping) {
      await onPushProduct(input);
    } else {
      await onCreateProduct(input);
    }
    setSheetOpen(false);
  };

  const editingDefaultTitle = editingTulipProduct
    ? editingTulipProduct.louezManaged
      ? `${editingTulipProduct.title} (Louez)`
      : editingTulipProduct.title
    : (editingProduct?.name ?? '');

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

        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
          <p className="text-muted-foreground text-sm">
            {t('coverageSummary', {
              insured: statusCounts.mapped,
              total: statusCounts.all,
            })}
          </p>
          {statusCounts.unmapped > 0 && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setStatusFilter('unmapped')}
            >
              {t('viewUnmappedCta', { count: statusCounts.unmapped })}
            </Button>
          )}
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
                        &rarr; {editingDefaultTitle}
                      </span>
                    )}
                  </div>

                  <TulipProductFormFields
                    draft={sheetDraft}
                    onDraftChange={(updater) =>
                      setSheetDraft((prev) => (prev ? updater(prev) : prev))
                    }
                    disabled={disabled || isRefreshing}
                    supportsMargin={supportsMargin}
                    defaultPrice={editingProduct.price}
                    defaultTitle={editingDefaultTitle}
                    resolvedCatalog={resolvedCatalog}
                    tulipProducts={tulipProducts}
                    t={t}
                    validation={validation}
                  />
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
