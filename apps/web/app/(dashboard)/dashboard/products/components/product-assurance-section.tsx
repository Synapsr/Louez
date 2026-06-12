'use client';

import { useState } from 'react';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, Pencil, Plus } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';

import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Combobox,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxPopup,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Label,
  toastManager,
} from '@louez/ui';

import { orpc } from '@/lib/orpc/react';

import {
  type ProductAssuranceActionInput,
  type ProductAssuranceDialogMode,
  ProductAssuranceDialog,
} from './product-assurance-dialog';

interface ProductAssuranceSectionProps {
  productId: string;
}

function extractErrorKey(error: unknown): string {
  if (error instanceof Error) {
    const match = error.message.match(/errors\.[a-zA-Z0-9_.-]+/);
    if (match?.[0]) {
      return match[0];
    }
  }

  return 'errors.generic';
}

function extractErrorDetails(error: unknown): string | undefined {
  if (
    typeof error === 'object' &&
    error !== null &&
    'data' in error &&
    typeof error.data === 'object' &&
    error.data !== null &&
    'details' in error.data &&
    typeof error.data.details === 'string'
  ) {
    const normalized = error.data.details.trim();
    return normalized || undefined;
  }

  return undefined;
}

export const ProductAssuranceSection = ({
  productId,
}: ProductAssuranceSectionProps) => {
  const t = useTranslations('dashboard.products.form.assurance');
  const tErrors = useTranslations('errors');
  const locale = useLocale();

  const queryClient = useQueryClient();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogMode, setDialogMode] =
    useState<ProductAssuranceDialogMode>('create');

  const productStateQuery = useQuery(
    orpc.dashboard.integrations.getTulipProductState.queryOptions({
      input: { productId },
    }),
  );

  const invalidateState = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: orpc.dashboard.integrations.getTulipProductState.key({
          input: { productId },
        }),
      }),
      queryClient.invalidateQueries({
        queryKey: orpc.dashboard.integrations.getTulipState.key({ input: {} }),
      }),
    ]);
  };

  const mappingMutation = useMutation(
    orpc.dashboard.integrations.upsertTulipProductMapping.mutationOptions({
      onSuccess: async () => {
        toastManager.add({ title: t('mappingSaved'), type: 'success' });
        await invalidateState();
      },
      onError: (error) => {
        const errorKey = extractErrorKey(error);
        toastManager.add({
          title: tErrors(errorKey.replace('errors.', '')),
          description: extractErrorDetails(error),
          type: 'error',
        });
      },
    }),
  );

  const pushProductMutation = useMutation(
    orpc.dashboard.integrations.pushTulipProductUpdate.mutationOptions({
      onSuccess: async () => {
        toastManager.add({ title: t('productUpdated'), type: 'success' });
        await invalidateState();
      },
      onError: (error) => {
        const errorKey = extractErrorKey(error);
        toastManager.add({
          title: tErrors(errorKey.replace('errors.', '')),
          description: extractErrorDetails(error),
          type: 'error',
        });
      },
    }),
  );

  const createProductMutation = useMutation(
    orpc.dashboard.integrations.createTulipProduct.mutationOptions({
      onSuccess: async () => {
        toastManager.add({ title: t('productCreated'), type: 'success' });
        await invalidateState();
      },
      onError: (error) => {
        const errorKey = extractErrorKey(error);
        toastManager.add({
          title: tErrors(errorKey.replace('errors.', '')),
          description: extractErrorDetails(error),
          type: 'error',
        });
      },
    }),
  );

  if (productStateQuery.isLoading) return null;

  const loadErrorKey =
    productStateQuery.data && 'error' in productStateQuery.data
      ? productStateQuery.data.error
      : productStateQuery.isError
        ? 'errors.generic'
        : null;

  if (
    loadErrorKey ||
    !productStateQuery.data ||
    'error' in productStateQuery.data
  ) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t('title')}</CardTitle>
          <CardDescription>{t('description')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-destructive text-sm">
            {tErrors((loadErrorKey ?? 'errors.generic').replace('errors.', ''))}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              void productStateQuery.refetch();
            }}
          >
            {t('retry')}
          </Button>
        </CardContent>
      </Card>
    );
  }

  const state = productStateQuery.data;

  if (!state.connected) return null;

  const tulipItems = state.tulipProducts.map((item) => ({
    label: item.louezManaged ? `${item.title} (Louez)` : item.title,
    value: item.id,
    brand: item.brand,
    model: item.model,
    productSubtype: item.productSubtype,
    valueExcl: item.valueExcl,
  }));
  const tulipProductById = new Map(
    state.tulipProducts.map((item) => [item.id, item] as const),
  );
  const hasValidMapping =
    !!state.product.tulipProductId &&
    tulipProductById.has(state.product.tulipProductId);

  const selectedTulipItem = hasValidMapping
    ? (tulipItems.find((item) => item.value === state.product.tulipProductId) ??
      null)
    : null;
  const hasTulipProductCatalogIssue =
    state.connectionIssue === 'errors.tulipProductCatalogUnavailable';
  const hasEmptyTulipProductsForRenter =
    state.connected &&
    state.tulipProducts.length === 0 &&
    !hasTulipProductCatalogIssue;
  const isMappingBusy =
    mappingMutation.isPending || productStateQuery.isRefetching;
  const isDialogBusy =
    isMappingBusy ||
    pushProductMutation.isPending ||
    createProductMutation.isPending;

  const currencyFormatter = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: 'EUR',
  });

  const formatTulipProductMeta = (item: {
    brand: string | null;
    model: string | null;
    productSubtype: string | null;
    valueExcl: number | null;
  }) => {
    const parts = [
      item.productSubtype?.trim(),
      item.brand?.trim(),
      item.model?.trim(),
      item.valueExcl != null
        ? t('dropdownValueExclTax', {
            value: currencyFormatter.format(item.valueExcl),
          })
        : '—',
    ].filter((part): part is string => Boolean(part && part.length > 0));

    return parts.join(' • ');
  };

  const openProductDialog = (mode: ProductAssuranceDialogMode) => {
    setDialogMode(mode);
    setDialogOpen(true);
  };

  return (
    <div id="section-assurance" className="scroll-mt-8">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
          <CardTitle>{t('title')}</CardTitle>
          <Badge variant={state.connected ? 'success' : 'secondary'}>
            {state.connected ? t('statusConnected') : t('statusNotConnected')}
          </Badge>
        </CardHeader>
        <CardContent className="space-y-4">
          {state.connectionIssue && (
            <p className="text-destructive text-sm">
              {tErrors(state.connectionIssue.replace('errors.', ''))}
            </p>
          )}

          <div className="space-y-3">
            <p className="text-muted-foreground text-sm">
              {t('linkOrCreateHelper')}
            </p>

            <div className="flex flex-col gap-3 md:flex-row md:items-end">
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <div className="flex items-center gap-2">
                  <Label htmlFor={`product-tulip-mapping-${productId}`}>
                    {t('mappingLabel')}
                  </Label>
                  <Badge
                    variant={hasValidMapping ? 'success' : 'secondary'}
                    size="sm"
                  >
                    {hasValidMapping ? t('statusMapped') : t('statusNotMapped')}
                  </Badge>
                </div>
                <Combobox
                  items={tulipItems}
                  value={selectedTulipItem}
                  onValueChange={(item) => {
                    mappingMutation.mutate({
                      productId: state.product.id,
                      tulipProductId: item?.value ?? null,
                    });
                  }}
                >
                  <ComboboxInput
                    id={`product-tulip-mapping-${productId}`}
                    showTrigger
                    showClear={!!state.product.tulipProductId}
                    placeholder={t('mappingPlaceholder')}
                    disabled={isMappingBusy}
                  />
                  <ComboboxPopup>
                    <ComboboxEmpty>
                      {hasTulipProductCatalogIssue
                        ? tErrors('tulipProductCatalogUnavailable')
                        : hasEmptyTulipProductsForRenter
                          ? t('noRenterProducts')
                          : t('noResults')}
                    </ComboboxEmpty>
                    <ComboboxList>
                      {(item) => (
                        <ComboboxItem key={item.value} value={item}>
                          <div className="min-w-0">
                            <div className="truncate font-medium">
                              {item.label}
                            </div>
                            <div className="text-muted-foreground truncate text-xs">
                              {formatTulipProductMeta(item)}
                            </div>
                          </div>
                        </ComboboxItem>
                      )}
                    </ComboboxList>
                  </ComboboxPopup>
                </Combobox>
              </div>

              {hasValidMapping ? (
                <div className="inline-flex">
                  <Button
                    type="button"
                    variant="outline"
                    className="rounded-r-none"
                    onClick={() => openProductDialog('update')}
                    disabled={isDialogBusy}
                  >
                    <Pencil />
                    {t('editMappedProductButton')}
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={
                        <Button
                          type="button"
                          variant="outline"
                          className="rounded-l-none border-l-0 px-2.5"
                          aria-label={t('editMappedProductButton')}
                          disabled={isDialogBusy}
                        />
                      }
                    >
                      <ChevronDown />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-56">
                      <DropdownMenuItem
                        onClick={() => openProductDialog('update')}
                      >
                        <Pencil />
                        {t('editMappedProductButton')}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => openProductDialog('create')}
                      >
                        <Plus />
                        {t('addNewProductButton')}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => openProductDialog('create')}
                  disabled={isDialogBusy}
                >
                  <Plus />
                  {t('addNewProductButton')}
                </Button>
              )}
            </div>

            {mappingMutation.isPending && (
              <p className="text-muted-foreground text-xs">
                {t('mappingSaving')}
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      <ProductAssuranceDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        mode={dialogMode}
        disabled={isDialogBusy}
        supportsMargin={state.supportsMargin}
        product={state.product}
        tulipCatalog={state.tulipCatalog}
        tulipProducts={state.tulipProducts}
        isCreatePending={createProductMutation.isPending}
        isPushPending={pushProductMutation.isPending}
        onPushProduct={async (input: ProductAssuranceActionInput) => {
          try {
            await pushProductMutation.mutateAsync(input);
          } catch {
            // Error handling is centralized in the mutation onError callback.
          }
        }}
        onCreateProduct={async (input: ProductAssuranceActionInput) => {
          try {
            await createProductMutation.mutateAsync(input);
          } catch {
            // Error handling is centralized in the mutation onError callback.
          }
        }}
      />
    </div>
  );
};
