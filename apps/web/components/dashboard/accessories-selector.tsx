'use client'

import { useState, useMemo } from 'react'
import { X, Search, Plus, GripVertical } from 'lucide-react'
import { useTranslations } from 'next-intl'

import { Button } from '@louez/ui'
import { Input } from '@louez/ui'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@louez/ui'
import { ScrollArea } from '@louez/ui'
import { formatCurrency } from '@louez/utils'
import { cn } from '@louez/utils'

interface Product {
  id: string
  name: string
  price: string
  images: string[] | null
}

interface AccessoriesSelectorProps {
  availableProducts: Product[]
  selectedIds: string[]
  onChange: (ids: string[]) => void
  currency?: string
  disabled?: boolean
}

export function AccessoriesSelector({
  availableProducts,
  selectedIds,
  onChange,
  currency = 'EUR',
  disabled = false,
}: AccessoriesSelectorProps) {
  const t = useTranslations('dashboard.products.form')
  const tCommon = useTranslations('common')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [search, setSearch] = useState('')

  // Get selected products with full data
  const selectedProducts = useMemo(() => {
    return selectedIds
      .map((id) => availableProducts.find((p) => p.id === id))
      .filter((p): p is Product => p !== undefined)
  }, [selectedIds, availableProducts])

  // Filter available products for the dialog
  const filteredProducts = useMemo(() => {
    const lowerSearch = search.toLowerCase()
    return availableProducts.filter(
      (p) =>
        !selectedIds.includes(p.id) &&
        p.name.toLowerCase().includes(lowerSearch)
    )
  }, [availableProducts, selectedIds, search])

  const handleAdd = (productId: string) => {
    onChange([...selectedIds, productId])
  }

  const handleRemove = (productId: string) => {
    onChange(selectedIds.filter((id) => id !== productId))
  }

  const handleReorder = (fromIndex: number, toIndex: number) => {
    const newIds = [...selectedIds]
    const [removed] = newIds.splice(fromIndex, 1)
    newIds.splice(toIndex, 0, removed)
    onChange(newIds)
  }

  return (
    <div className="space-y-4">
      {/* Selected accessories */}
      {selectedProducts.length > 0 && (
        <div className="space-y-2">
          {selectedProducts.map((product, index) => (
            <div
              key={product.id}
              className={cn(
                'flex items-center gap-3 rounded-lg border bg-card p-3 transition-colors',
                'hover:bg-muted/50'
              )}
            >
              <button
                type="button"
                className="cursor-grab text-muted-foreground hover:text-foreground"
                onMouseDown={(e) => {
                  e.preventDefault()
                  const startY = e.clientY
                  const startIndex = index

                  const handleMouseMove = (moveEvent: MouseEvent) => {
                    const diff = moveEvent.clientY - startY
                    const itemHeight = 64 // approximate height of each item
                    const indexDiff = Math.round(diff / itemHeight)
                    const newIndex = Math.max(
                      0,
                      Math.min(selectedProducts.length - 1, startIndex + indexDiff)
                    )
                    if (newIndex !== startIndex) {
                      handleReorder(startIndex, newIndex)
                    }
                  }

                  const handleMouseUp = () => {
                    document.removeEventListener('mousemove', handleMouseMove)
                    document.removeEventListener('mouseup', handleMouseUp)
                  }

                  document.addEventListener('mousemove', handleMouseMove)
                  document.addEventListener('mouseup', handleMouseUp)
                }}
              >
                <GripVertical className="h-4 w-4" />
              </button>

              <div className="h-12 w-12 flex-shrink-0 overflow-hidden rounded-md bg-muted">
                {product.images && product.images[0] ? (
                  <img
                    src={product.images[0]}
                    alt={product.name}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                    <span className="text-xs">No img</span>
                  </div>
                )}
              </div>

              <div className="flex-1 min-w-0">
                <p className="font-medium truncate">{product.name}</p>
                <p className="text-sm text-muted-foreground">
                  {formatCurrency(parseFloat(product.price), currency)}
                </p>
              </div>

              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 flex-shrink-0 text-muted-foreground hover:text-destructive"
                onClick={() => handleRemove(product.id)}
                disabled={disabled}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      )}

      {/* Add accessory button */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogTrigger render={<Button
            type="button"
            variant="outline"
            className="w-full border-dashed"
            disabled={disabled || filteredProducts.length === 0}
          />}>
            <Plus className="mr-2 h-4 w-4" />
            {t('addAccessory')}
        </DialogTrigger>
        <DialogContent className="max-w-md flex flex-col max-h-[80vh]">
          <DialogHeader className="flex-shrink-0">
            <DialogTitle>{t('selectAccessories')}</DialogTitle>
            <DialogDescription>{t('selectAccessoriesDescription')}</DialogDescription>
          </DialogHeader>

          <div className="flex-1 min-h-0 flex flex-col gap-4 py-4">
            {/* Search */}
            <div className="relative flex-shrink-0">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder={t('searchProducts')}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>

            {/* Products list - scrollable */}
            <ScrollArea className="flex-1 -mx-6 px-6">
              <div className="space-y-2">
                {filteredProducts.length === 0 ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    {search ? t('noProductsFound') : t('noProductsAvailable')}
                  </p>
                ) : (
                  filteredProducts.map((product) => (
                    <button
                      key={product.id}
                      type="button"
                      className={cn(
                        'flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors',
                        'hover:bg-muted/50 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2'
                      )}
                      onClick={() => {
                        handleAdd(product.id)
                        setSearch('')
                      }}
                    >
                      <div className="h-10 w-10 flex-shrink-0 overflow-hidden rounded-md bg-muted">
                        {product.images && product.images[0] ? (
                          <img
                            src={product.images[0]}
                            alt={product.name}
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                            <span className="text-[10px]">No img</span>
                          </div>
                        )}
                      </div>

                      <div className="flex-1 min-w-0">
                        <p className="font-medium truncate">{product.name}</p>
                        <p className="text-sm text-muted-foreground">
                          {formatCurrency(parseFloat(product.price), currency)}
                        </p>
                      </div>

                      <Plus className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
                    </button>
                  ))
                )}
              </div>
            </ScrollArea>
          </div>

          {/* Footer with close button */}
          <div className="flex-shrink-0 flex justify-end pt-4 border-t">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setDialogOpen(false)
                setSearch('')
              }}
            >
              {tCommon('close')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Helper text */}
      {selectedProducts.length === 0 && (
        <p className="text-xs text-muted-foreground">{t('accessoriesHelp')}</p>
      )}
    </div>
  )
}
