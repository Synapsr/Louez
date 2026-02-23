import { useCallback } from 'react'

import { useMutation } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'

import type { ProductInput } from '@louez/validations'

import { createCategory, createProduct, updateProduct } from '../actions'

interface UseProductFormMutationsParams {
  productId?: string
}

export interface ProductActionErrorDetails {
  code?: string
  duplicateRateTierIndexes?: number[]
}

interface ProductActionErrorPayload {
  error: string
  details?: ProductActionErrorDetails
}

function isProductActionErrorPayload(
  value: unknown,
): value is ProductActionErrorPayload {
  if (!value || typeof value !== 'object') return false
  return 'error' in value && typeof (value as { error?: unknown }).error === 'string'
}

export function useProductFormMutations({
  productId,
}: UseProductFormMutationsParams) {
  const tErrors = useTranslations('errors')

  const productMutation = useMutation({
    mutationFn: async (value: ProductInput) => {
      const result = productId
        ? await updateProduct(productId, value)
        : await createProduct(value)

      if (result.error) {
        throw {
          error: result.error,
          details:
            'details' in result && result.details
              ? result.details
              : undefined,
        } satisfies ProductActionErrorPayload
      }

      return result
    },
  })

  const createCategoryMutation = useMutation({
    mutationFn: async (name: string) => {
      const result = await createCategory({ name })

      if (result.error) {
        throw new Error(result.error)
      }

      return result
    },
  })

  const getActionErrorMessage = useCallback(
    (error: unknown) => {
      if (isProductActionErrorPayload(error)) {
        if (error.error.startsWith('errors.')) {
          return tErrors(error.error.replace('errors.', ''))
        }

        return error.error
      }

      if (error instanceof Error) {
        if (error.message.startsWith('errors.')) {
          return tErrors(error.message.replace('errors.', ''))
        }

        return error.message
      }

      return tErrors('generic')
    },
    [tErrors]
  )

  const getActionErrorDetails = useCallback(
    (error: unknown): ProductActionErrorDetails | undefined => {
      if (isProductActionErrorPayload(error)) {
        return error.details
      }
      return undefined
    },
    []
  )

  const submitProduct = useCallback(
    async (value: ProductInput) => productMutation.mutateAsync(value),
    [productMutation]
  )

  const createCategoryByName = useCallback(
    async (name: string) => createCategoryMutation.mutateAsync(name),
    [createCategoryMutation]
  )

  return {
    productMutation,
    createCategoryMutation,
    isSaving: productMutation.isPending,
    isCreatingCategory: createCategoryMutation.isPending,
    submitProduct,
    createCategoryByName,
    getActionErrorMessage,
    getActionErrorDetails,
  }
}
