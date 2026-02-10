'use client'

import { useState } from 'react'
import Image from 'next/image'
import { useTranslations } from 'next-intl'
import { Reorder, useDragControls } from 'framer-motion'
import { GripVertical, Package, Loader2 } from 'lucide-react'
import { toastManager } from '@louez/ui'

import { Button } from '@louez/ui'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@louez/ui'
import { ScrollArea } from '@louez/ui'

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

function ProductImage({ src, alt }: { src?: string; alt: string }) {
  if (!src) {
    return (
      <div className="flex h-10 w-10 items-center justify-center rounded-md bg-muted">
        <Package className="h-4 w-4 text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="relative h-10 w-10 overflow-hidden rounded-md bg-muted">
      <Image src={src} alt={alt} fill className="object-cover" sizes="40px" />
    </div>
  )
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
      <ProductImage src={product.images?.[0]} alt={product.name} />
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

  const [products, setProducts] = useState(initialProducts)
  const [isLoading, setIsLoading] = useState(false)

  // Reset products when dialog opens
  const handleOpenChange = (newOpen: boolean) => {
    if (newOpen) {
      setProducts(initialProducts)
    }
    onOpenChange(newOpen)
  }

  const handleSave = async () => {
    setIsLoading(true)
    try {
      const productIds = products.map((p) => p.id)
      const result = await updateProductsOrder(productIds)

      if (result.error) {
        toastManager.add({ title: tErrors(result.error), type: 'error' })
      } else {
        toastManager.add({ title: t('orderUpdated'), type: 'success' })
        onOpenChange(false)
      }
    } catch {
      toastManager.add({ title: tErrors('generic'), type: 'error' })
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('orderDialog.title')}</DialogTitle>
          <DialogDescription>{t('orderDialog.description')}</DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[60vh] pr-4">
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
        </ScrollArea>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isLoading}
          >
            {tCommon('cancel')}
          </Button>
          <Button onClick={handleSave} disabled={isLoading}>
            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {tCommon('save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
