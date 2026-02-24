'use client';

import { useState } from 'react';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';

import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  toastManager,
} from '@louez/ui';

import { orpc } from '@/lib/orpc/react';

import { TulipConfigurationSection } from './tulip-configuration-section';
import { TulipProductMappingSection } from './tulip-product-mapping-section';
import { TulipSetupSection } from './tulip-setup-section';

const FALLBACK_STATE = {
  connected: false,
  enabled: false,
  supportsMargin: false,
  inclusionEnabled: false,
  connectedAt: null,
  connectionIssue: null,
  calendlyUrl: 'https://calendly.com/',
  settings: {
    publicMode: 'required' as const,
    renterUid: null,
  },
  renters: [],
  tulipCatalog: [],
  tulipProducts: [],
  products: [],
};

function extractErrorKey(error: unknown): string {
  if (error instanceof Error) {
    const match = error.message.match(/errors\.[a-zA-Z0-9_.-]+/);
    if (match?.[0]) {
      return match[0];
    }
  }

  return 'errors.generic';
}

export function TulipAssurancePanel() {
  const t = useTranslations('dashboard.settings.integrationsPage.assurance');
  const tErrors = useTranslations('errors');
  const queryClient = useQueryClient();

  const [mappingProductId, setMappingProductId] = useState<string | null>(null);
  const [pushProductId, setPushProductId] = useState<string | null>(null);
  const [createProductId, setCreateProductId] = useState<string | null>(null);
  const [disconnectDialogOpen, setDisconnectDialogOpen] = useState(false);

  const tulipStateQuery = useQuery(
    orpc.dashboard.integrations.getTulipState.queryOptions({
      input: {},
    }),
  );

  const invalidateTulipState = async () => {
    await queryClient.invalidateQueries({
      queryKey: orpc.dashboard.integrations.getTulipState.key({ input: {} }),
    });
  };

  const connectTulipMutation = useMutation(
    orpc.dashboard.integrations.connectTulip.mutationOptions({
      onSuccess: async () => {
        toastManager.add({ title: t('setupSuccess'), type: 'success' });
        await invalidateTulipState();
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

  const updateConfigurationMutation = useMutation(
    orpc.dashboard.integrations.updateTulipConfiguration.mutationOptions({
      onSuccess: async () => {
        toastManager.add({ title: t('configurationSaved'), type: 'success' });
        await invalidateTulipState();
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

  const disconnectTulipMutation = useMutation(
    orpc.dashboard.integrations.disconnectTulip.mutationOptions({
      onSuccess: async () => {
        toastManager.add({ title: t('disconnectSuccess'), type: 'success' });
        await invalidateTulipState();
      },
      onError: (error) => {
        const errorKey = extractErrorKey(error);
        toastManager.add({
          title: tErrors(errorKey.replace('errors.', '')),
          type: 'error',
        });
      },
      onSettled: () => {
        setDisconnectDialogOpen(false);
      },
    }),
  );

  const upsertMappingMutation = useMutation(
    orpc.dashboard.integrations.upsertTulipProductMapping.mutationOptions({
      onSuccess: async () => {
        toastManager.add({ title: t('mappingSaved'), type: 'success' });
        await invalidateTulipState();
      },
      onError: (error) => {
        const errorKey = extractErrorKey(error);
        toastManager.add({
          title: tErrors(errorKey.replace('errors.', '')),
          type: 'error',
        });
      },
      onSettled: () => {
        setMappingProductId(null);
      },
    }),
  );

  const pushProductMutation = useMutation(
    orpc.dashboard.integrations.pushTulipProductUpdate.mutationOptions({
      onSuccess: () => {
        toastManager.add({ title: t('productUpdated'), type: 'success' });
      },
      onError: (error) => {
        const errorKey = extractErrorKey(error);
        toastManager.add({
          title: tErrors(errorKey.replace('errors.', '')),
          type: 'error',
        });
      },
      onSettled: () => {
        setPushProductId(null);
      },
    }),
  );

  const createProductMutation = useMutation(
    orpc.dashboard.integrations.createTulipProduct.mutationOptions({
      onSuccess: async () => {
        toastManager.add({ title: t('productCreated'), type: 'success' });
        await invalidateTulipState();
      },
      onError: (error) => {
        const errorKey = extractErrorKey(error);
        toastManager.add({
          title: tErrors(errorKey.replace('errors.', '')),
          type: 'error',
        });
      },
      onSettled: () => {
        setCreateProductId(null);
      },
    }),
  );

  if (tulipStateQuery.isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t('title')}</CardTitle>
          <CardDescription>{t('description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-muted-foreground text-sm">{t('loading')}</p>
        </CardContent>
      </Card>
    );
  }

  const state =
    tulipStateQuery.data && !('error' in tulipStateQuery.data)
      ? tulipStateQuery.data
      : FALLBACK_STATE;
  const isConnected = state.connected;

  return (
    <div className="space-y-6">
      <TulipSetupSection
        connected={state.connected}
        renterUid={state.settings.renterUid}
        connectedAt={state.connectedAt}
        calendlyUrl={state.calendlyUrl}
        isPending={connectTulipMutation.isPending}
        onConnect={async (renterUid) => {
          await connectTulipMutation.mutateAsync({ renterUid });
        }}
      />
      {isConnected && !state.inclusionEnabled && (
        <TulipConfigurationSection
          disabled={false}
          settings={state.settings}
          isPending={updateConfigurationMutation.isPending}
          onSave={async (input) => {
            await updateConfigurationMutation.mutateAsync(input);
          }}
        />
      )}
      {isConnected && (
        <TulipProductMappingSection
          disabled={!isConnected}
          supportsMargin={state.supportsMargin}
          products={state.products}
          tulipCatalog={state.tulipCatalog}
          tulipProducts={state.tulipProducts}
          isMappingPending={upsertMappingMutation.isPending}
          mappingProductId={mappingProductId}
          isPushPending={pushProductMutation.isPending}
          pushProductId={pushProductId}
          isCreatePending={createProductMutation.isPending}
          createProductId={createProductId}
          isRefreshing={tulipStateQuery.isRefetching}
          onRefresh={async () => {
            await tulipStateQuery.refetch();
          }}
          onMappingChange={async (productId, tulipProductId) => {
            setMappingProductId(productId);
            await upsertMappingMutation.mutateAsync({
              productId,
              tulipProductId,
            });
          }}
          onPushProduct={async (input) => {
            setPushProductId(input.productId);
            await pushProductMutation.mutateAsync(input);
          }}
          onCreateProduct={async (input) => {
            setCreateProductId(input.productId);
            await createProductMutation.mutateAsync(input);
          }}
        />
      )}
      {isConnected && (
        <Card>
          <CardHeader>
            <CardTitle>{t('disconnect.title')}</CardTitle>
            <CardDescription>{t('disconnect.description')}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              variant="destructive"
              onClick={() => setDisconnectDialogOpen(true)}
            >
              {t('disconnect.button')}
            </Button>
            <AlertDialog
              open={disconnectDialogOpen}
              onOpenChange={setDisconnectDialogOpen}
            >
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    {t('disconnect.confirmTitle')}
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    {t('disconnect.confirmDescription')}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogClose render={<Button variant="outline" />}>
                    {t('disconnect.cancelButton')}
                  </AlertDialogClose>
                  <Button
                    variant="destructive"
                    disabled={disconnectTulipMutation.isPending}
                    onClick={async () => {
                      await disconnectTulipMutation.mutateAsync({});
                    }}
                  >
                    {disconnectTulipMutation.isPending
                      ? t('disconnect.disconnectingButton')
                      : t('disconnect.confirmButton')}
                  </Button>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
