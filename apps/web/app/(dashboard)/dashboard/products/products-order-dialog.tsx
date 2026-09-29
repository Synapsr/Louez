'use client'

import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslations } from 'next-intl'
import { Reorder, useDragControls } from 'framer-motion'
import { GripVertical } from 'lucide-react'
import { toastManager } from '@louez/ui'

import { ProductImage } from '@/components/product/product-image'

import { Button } from '@louez/ui'
import {
  Dialog,
  DialogPopup,
  DialogPanel,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@louez/ui'

import { invalidateProductsList } from '@/lib/orpc/invalidation'

import { updateProductsOrder } from './actions'

interface Product {
  id: string
  name: string
  images: string[] | null
}

interface ProductsOrderDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  products: Product[]
}


interface DraggableProductProps {
  product: Product
}

function DraggableProduct({ product }: DraggableProductProps) {
  const controls = useDragControls()

  return (
    <Reorder.Item
      value={product}
      dragListener={false}
      dragControls={controls}
      className="flex items-center gap-3 rounded-lg border bg-background p-3 shadow-sm"
    >
      <button
        type="button"
        onPointerDown={(e) => controls.start(e)}
        className="cursor-grab touch-none text-muted-foreground hover:text-foreground active:cursor-grabbing"
        aria-label="Drag to reorder"
      >
        <GripVertical className="h-5 w-5" />
      </button>
      <ProductImage
        src={product.images?.[0]}
        alt={product.name}
        sizes="48px"
        containerClassName="h-9 shrink-0 rounded-md"
      />
      <span className="flex-1 truncate text-sm font-medium">{product.name}</span>
    </Reorder.Item>
  )
}

export function ProductsOrderDialog({
  open,
  onOpenChange,
  products: initialProducts,
}: ProductsOrderDialogProps) {
  const t = useTranslations('dashboard.products')
  const tCommon = useTranslations('common')
  const tErrors = useTranslations('errors')
  const queryClient = useQueryClient()

  const [products, setProducts] = useState(initialProducts)
  const [isLoading, setIsLoading] = useState(false)

  // The dialog stays mounted and the parent opens it through `open`, so pick
  // up the current list each time it opens. Otherwise it keeps the list from
  // the first render and saves a stale order.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) setProducts(initialProducts)
  }

  const handleSave = async () => {
    setIsLoading(true)
    try {
      const productIds = products.map((p) => p.id)
      const result = await updateProductsOrder(productIds)

      if (result.error) {
        toastManager.add({ title: tErrors(result.error.replace(/^errors\./, '')), type: 'error' })
      } else {
        toastManager.add({ title: t('orderUpdated'), type: 'success' })
        await invalidateProductsList(queryClient)
        onOpenChange(false)
      }
    } catch {
      toastManager.add({ title: tErrors('generic'), type: 'error' })
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('orderDialog.title')}</DialogTitle>
          <DialogDescription>{t('orderDialog.description')}</DialogDescription>
        </DialogHeader>

        <DialogPanel>
          <Reorder.Group
            axis="y"
            values={products}
            onReorder={setProducts}
            className="space-y-2"
          >
            {products.map((product) => (
              <DraggableProduct key={product.id} product={product} />
            ))}
          </Reorder.Group>
        </DialogPanel>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isLoading}
          >
            {tCommon('cancel')}
          </Button>
          <Button onClick={handleSave} isPending={isLoading}>
            {tCommon('save')}
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  )
}
