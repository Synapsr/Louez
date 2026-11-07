'use client';

import { useState } from 'react';

import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';

import { toastManager } from '@louez/ui';

import { apiErrorKey } from '@/lib/orpc/errors';
import { orpc } from '@/lib/orpc/react';
import { productsQueries } from '@/lib/queries/products.queries';

type ProductStatus = 'draft' | 'active' | 'archived' | null;

export interface ActionableProduct {
  id: string;
  status: ProductStatus;
}

/**
 * Shared mutation logic for product status/duplicate/delete actions.
 *
 * Used by both `products-table.tsx` (row actions) and the product detail
 * page's header dropdown, so the two surfaces stay behaviorally identical.
 */
export function useProductActions({ readOnly = false }: { readOnly?: boolean } = {}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const t = useTranslations('dashboard.products');
  const tErrors = useTranslations('errors');

  /**
   * The list is served by React Query, the surrounding page (limits, banners)
   * by the server — both need refreshing after a mutation.
   */
  const refreshProducts = async () => {
    await queryClient.invalidateQueries({ queryKey: productsQueries.key() });
    router.refresh();
  };

  const statusMutation = useMutation(orpc.dashboard.products.updateStatus.mutationOptions());
  const duplicateMutation = useMutation(orpc.dashboard.products.duplicate.mutationOptions());
  const deleteMutation = useMutation(orpc.dashboard.products.delete.mutationOptions());

  const [isLoading, setIsLoading] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [productToDelete, setProductToDelete] =
    useState<ActionableProduct | null>(null);

  /** The error's message; the units a reservation holds are named after it. */
  const getActionErrorMessage = (error: unknown) => {
    const key = apiErrorKey(error);
    const message = key && tErrors.has(key) ? tErrors(key) : tErrors('generic');
    const details = (error as { data?: { details?: { identifiers?: unknown } } } | null)?.data
      ?.details;
    const identifiers = Array.isArray(details?.identifiers)
      ? details.identifiers.filter((identifier): identifier is string => Boolean(identifier))
      : [];
    return identifiers.length > 0 ? `${message} (${identifiers.join(', ')})` : message;
  };

  const handleStatusToggle = async (product: ActionableProduct) => {
    if (readOnly) return;
    const newStatus = product.status === 'active' ? 'draft' : 'active';
    setIsLoading(true);
    try {
      await statusMutation.mutateAsync({ id: product.id, status: newStatus });
      toastManager.add({
        title:
          newStatus === 'active'
            ? t('productPublished')
            : t('productUnpublished'),
        type: 'success',
      });
      await refreshProducts();
    } catch (error) {
      toastManager.add({ title: getActionErrorMessage(error), type: 'error' });
    } finally {
      setIsLoading(false);
    }
  };

  const handleArchive = async (product: ActionableProduct) => {
    if (readOnly) return;
    setIsLoading(true);
    try {
      await statusMutation.mutateAsync({ id: product.id, status: 'archived' });
      toastManager.add({ title: t('productArchived'), type: 'success' });
      await refreshProducts();
    } catch (error) {
      toastManager.add({ title: getActionErrorMessage(error), type: 'error' });
    } finally {
      setIsLoading(false);
    }
  };

  const handleDuplicate = async (product: ActionableProduct) => {
    if (readOnly) return;
    setIsLoading(true);
    try {
      await duplicateMutation.mutateAsync({ id: product.id });
      toastManager.add({ title: t('productDuplicated'), type: 'success' });
      await refreshProducts();
    } catch (error) {
      toastManager.add({ title: getActionErrorMessage(error), type: 'error' });
    } finally {
      setIsLoading(false);
    }
  };

  const requestDelete = (product: ActionableProduct) => {
    if (readOnly) return;
    setProductToDelete(product);
    setDeleteDialogOpen(true);
  };

  /**
   * `redirectTo` is used by the product detail page: refreshing the current
   * route after deleting the product being viewed would just 404. The list
   * row actions don't need it (refreshing the list is correct there).
   */
  const handleDelete = async (options?: { redirectTo?: string }) => {
    if (readOnly) return;
    if (!productToDelete) return;

    setIsLoading(true);
    try {
      await deleteMutation.mutateAsync({ id: productToDelete.id });
      toastManager.add({ title: t('productDeleted'), type: 'success' });
      if (options?.redirectTo) {
        await queryClient.invalidateQueries({ queryKey: productsQueries.key() });
        router.push(options.redirectTo);
      } else {
        await refreshProducts();
      }
    } catch (error) {
      toastManager.add({ title: getActionErrorMessage(error), type: 'error' });
    } finally {
      setIsLoading(false);
      setDeleteDialogOpen(false);
      setProductToDelete(null);
    }
  };

  return {
    isLoading,
    deleteDialogOpen,
    setDeleteDialogOpen,
    productToDelete,
    handleStatusToggle,
    handleArchive,
    handleDuplicate,
    requestDelete,
    handleDelete,
  };
}
