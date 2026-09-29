'use client';

import { useState } from 'react';

import { useRouter } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';

import { toastManager } from '@louez/ui';

import {
  deleteProduct,
  duplicateProduct,
  updateProductStatus,
} from '@/app/(dashboard)/dashboard/products/actions';
import { invalidateProductsList } from '@/lib/orpc/invalidation';

type ProductStatus = 'draft' | 'active' | 'archived' | null;

export interface ActionableProduct {
  id: string;
  status: ProductStatus;
}

type ProductActionResult = {
  error?: string;
  failedUnitIdentifiers?: string[];
};

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
    await invalidateProductsList(queryClient);
    router.refresh();
  };

  const [isLoading, setIsLoading] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [productToDelete, setProductToDelete] =
    useState<ActionableProduct | null>(null);

  const getActionErrorMessage = (result: ProductActionResult) => {
    const errorKey = result.error?.startsWith('errors.')
      ? result.error.replace('errors.', '')
      : null;
    const message = errorKey && result.error ? tErrors(errorKey) : result.error;
    const identifiers = result.failedUnitIdentifiers?.filter(Boolean);

    if (identifiers && identifiers.length > 0) {
      return `${message || tErrors('generic')} (${identifiers.join(', ')})`;
    }

    return message || tErrors('generic');
  };

  const handleStatusToggle = async (product: ActionableProduct) => {
    if (readOnly) return;
    const newStatus = product.status === 'active' ? 'draft' : 'active';
    setIsLoading(true);
    try {
      const result = await updateProductStatus(product.id, newStatus);
      if (result.error) {
        toastManager.add({
          title: getActionErrorMessage(result),
          type: 'error',
        });
      } else {
        toastManager.add({
          title:
            newStatus === 'active'
              ? t('productPublished')
              : t('productUnpublished'),
          type: 'success',
        });
        await refreshProducts();
      }
    } catch {
      toastManager.add({ title: tErrors('generic'), type: 'error' });
    } finally {
      setIsLoading(false);
    }
  };

  const handleArchive = async (product: ActionableProduct) => {
    if (readOnly) return;
    setIsLoading(true);
    try {
      const result = await updateProductStatus(product.id, 'archived');
      if (result.error) {
        toastManager.add({
          title: getActionErrorMessage(result),
          type: 'error',
        });
      } else {
        toastManager.add({ title: t('productArchived'), type: 'success' });
        await refreshProducts();
      }
    } catch {
      toastManager.add({ title: tErrors('generic'), type: 'error' });
    } finally {
      setIsLoading(false);
    }
  };

  const handleDuplicate = async (product: ActionableProduct) => {
    if (readOnly) return;
    setIsLoading(true);
    try {
      const result = await duplicateProduct(product.id);
      if (result.error) {
        toastManager.add({
          title: getActionErrorMessage(result),
          type: 'error',
        });
      } else {
        toastManager.add({ title: t('productDuplicated'), type: 'success' });
        await refreshProducts();
      }
    } catch {
      toastManager.add({ title: tErrors('generic'), type: 'error' });
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
      const result = await deleteProduct(productToDelete.id);
      if (result.error) {
        toastManager.add({
          title: getActionErrorMessage(result),
          type: 'error',
        });
      } else {
        toastManager.add({ title: t('productDeleted'), type: 'success' });
        if (options?.redirectTo) {
          await invalidateProductsList(queryClient);
          router.push(options.redirectTo);
        } else {
          await refreshProducts();
        }
      }
    } catch {
      toastManager.add({ title: tErrors('generic'), type: 'error' });
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
