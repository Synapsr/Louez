'use client';

import { type FormEvent, useState } from 'react';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';

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
  Input,
  Label,
  Skeleton,
  toastManager,
} from '@louez/ui';

import { orpc } from '@/lib/orpc/react';

import {
  type ProductAssuranceActionInput,
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

export function ProductAssuranceSection({
  productId,
}: ProductAssuranceSectionProps) {
  const t = useTranslations('dashboard.products.form.assurance');
  const tErrors = useTranslations('errors');

  const queryClient = useQueryClient();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [apiKey, setApiKey] = useState('');

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

  const connectMutation = useMutation(
    orpc.dashboard.integrations.connectTulip.mutationOptions({
      onSuccess: async () => {
        toastManager.add({ title: t('setupSuccess'), type: 'success' });
        setApiKey('');
        await invalidateState();
      },
      onError: (error) => {
        const errorKey = extractErrorKey(error);
        toastManager.add({
          title: tErrors(errorKey.replace('errors.', '')),
          type: 'error',
        });
      },
    }),
  );

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
          type: 'error',
        });
      },
    }),
  );

  const handleConnect = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const sanitized = apiKey.trim();
    if (!sanitized) return;

    await connectMutation.mutateAsync({ apiKey: sanitized });
  };

  if (productStateQuery.isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t('title')}</CardTitle>
          <CardDescription>{t('description')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-10 w-full" />
          <div className="flex gap-2">
            <Skeleton className="h-9 w-28" />
            <Skeleton className="h-9 w-44" />
          </div>
        </CardContent>
      </Card>
    );
  }

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

  const tulipItems = state.tulipProducts.map((item) => ({
    label: item.title,
    value: item.id,
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

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
          <div className="space-y-1.5">
            <CardTitle>{t('title')}</CardTitle>
            {/* <CardDescription>{t('description')}</CardDescription> */}
          </div>
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

          {!state.connected ? (
            <form className="space-y-4" onSubmit={handleConnect}>
              <div className="grid gap-2">
                <Label htmlFor={`product-tulip-api-key-${productId}`}>
                  {t('apiKeyLabel')}
                </Label>
                <Input
                  id={`product-tulip-api-key-${productId}`}
                  type="password"
                  value={apiKey}
                  placeholder={t('apiKeyPlaceholder')}
                  onChange={(event) => setApiKey(event.target.value)}
                  disabled={connectMutation.isPending}
                />
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  type="submit"
                  disabled={
                    connectMutation.isPending || apiKey.trim().length === 0
                  }
                >
                  {connectMutation.isPending
                    ? t('validatingButton')
                    : t('validateButton')}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  render={
                    <a
                      href={state.calendlyUrl}
                      target="_blank"
                      rel="noreferrer"
                    />
                  }
                >
                  {t('bookAppointmentButton')}
                </Button>
              </div>
            </form>
          ) : (
            <div className="space-y-4">
              {/*  <div className="flex items-center gap-2">
                <Badge
                  variant={hasValidMapping ? 'success' : 'secondary'}
                  size="sm"
                >
                  {hasValidMapping ? t('statusMapped') : t('statusNotMapped')}
                </Badge>
                {hasValidMapping && selectedTulipItem && (
                  <span className="text-muted-foreground text-sm">
                    {t('mappedTo', { title: selectedTulipItem.label })}
                  </span>
                )}
              </div> */}

              <div className="space-y-3">
                <p className="text-muted-foreground text-sm">
                  {t('linkOrCreateHelper')}
                </p>

                <div className="flex flex-col gap-3 md:flex-row md:items-end">
                  <div className="flex min-w-0 flex-1 flex-col gap-2">
                    <Label htmlFor={`product-tulip-mapping-${productId}`}>
                      {t('mappingLabel')}{' '}
                      <Badge
                        variant={hasValidMapping ? 'success' : 'secondary'}
                        size="sm"
                      >
                        {hasValidMapping
                          ? t('statusMapped')
                          : t('statusNotMapped')}
                      </Badge>
                    </Label>
                    <Combobox
                      items={tulipItems}
                      value={selectedTulipItem}
                      onValueChange={(item) => {
                        void mappingMutation.mutateAsync({
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
                        disabled={
                          mappingMutation.isPending ||
                          productStateQuery.isRefetching
                        }
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

                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setDialogOpen(true)}
                    disabled={
                      mappingMutation.isPending ||
                      productStateQuery.isRefetching ||
                      pushProductMutation.isPending ||
                      createProductMutation.isPending
                    }
                  >
                    {t('addNewProductButton')}
                  </Button>
                </div>

                {mappingMutation.isPending && (
                  <p className="text-muted-foreground text-xs">
                    {t('mappingSaving')}
                  </p>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {state.connected && (
        <ProductAssuranceDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          disabled={
            productStateQuery.isRefetching ||
            mappingMutation.isPending ||
            pushProductMutation.isPending ||
            createProductMutation.isPending
          }
          product={state.product}
          tulipProducts={state.tulipProducts}
          isCreatePending={createProductMutation.isPending}
          isPushPending={pushProductMutation.isPending}
          onPushProduct={async (input: ProductAssuranceActionInput) => {
            await pushProductMutation.mutateAsync(input);
          }}
          onCreateProduct={async (input: ProductAssuranceActionInput) => {
            await createProductMutation.mutateAsync(input);
          }}
        />
      )}
    </>
  );
}
