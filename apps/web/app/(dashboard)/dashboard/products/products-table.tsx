'use client'

import Link from 'next/link'
import Image from 'next/image'
import { useState } from 'react'
import { useTranslations } from 'next-intl'
import {
  MoreHorizontal,
  Pencil,
  Copy,
  Archive,
  Trash2,
  Eye,
  EyeOff,
  Package,
} from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@louez/ui'
import { Badge } from '@louez/ui'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@louez/ui'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@louez/ui'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@louez/ui'

import { updateProductStatus, deleteProduct, duplicateProduct } from './actions'
import { getCurrencySymbol } from '@louez/utils'

interface Product {
  id: string
  name: string
  images: string[] | null
  price: string
  deposit: string | null
  quantity: number
  status: 'draft' | 'active' | 'archived' | null
  category: {
    id: string
    name: string
  } | null
}

interface ProductsTableProps {
  products: Product[]
  currency?: string
}

const STATUS_STYLES = {
  active: 'bg-green-500/10 text-green-600 hover:bg-green-500/20',
  draft: 'bg-yellow-500/10 text-yellow-600 hover:bg-yellow-500/20',
  archived: 'bg-muted text-muted-foreground',
}

function ProductImage({ src, alt }: { src?: string; alt: string }) {
  if (!src) {
    return (
      <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-muted">
        <Package className="h-5 w-5 text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="relative h-12 w-12 overflow-hidden rounded-lg bg-muted">
      <Image
        src={src}
        alt={alt}
        fill
        className="object-cover"
        sizes="48px"
      />
    </div>
  )
}

export function ProductsTable({ products, currency = 'EUR' }: ProductsTableProps) {
  const t = useTranslations('dashboard.products')
  const tCommon = useTranslations('common')
  const tErrors = useTranslations('errors')
  const currencySymbol = getCurrencySymbol(currency)

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [productToDelete, setProductToDelete] = useState<Product | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  const handleStatusToggle = async (product: Product) => {
    const newStatus = product.status === 'active' ? 'draft' : 'active'
    setIsLoading(true)
    try {
      const result = await updateProductStatus(product.id, newStatus)
      if (result.error) {
        toast.error(result.error)
      } else {
        toast.success(
          newStatus === 'active'
            ? t('productPublished')
            : t('productUnpublished')
        )
      }
    } catch {
      toast.error(tErrors('generic'))
    } finally {
      setIsLoading(false)
    }
  }

  const handleArchive = async (product: Product) => {
    setIsLoading(true)
    try {
      const result = await updateProductStatus(product.id, 'archived')
      if (result.error) {
        toast.error(result.error)
      } else {
        toast.success(t('productArchived'))
      }
    } catch {
      toast.error(tErrors('generic'))
    } finally {
      setIsLoading(false)
    }
  }

  const handleDuplicate = async (product: Product) => {
    setIsLoading(true)
    try {
      const result = await duplicateProduct(product.id)
      if (result.error) {
        toast.error(result.error)
      } else {
        toast.success(t('productDuplicated'))
      }
    } catch {
      toast.error(tErrors('generic'))
    } finally {
      setIsLoading(false)
    }
  }

  const handleDelete = async () => {
    if (!productToDelete) return

    setIsLoading(true)
    try {
      const result = await deleteProduct(productToDelete.id)
      if (result.error) {
        toast.error(result.error)
      } else {
        toast.success(t('productDeleted'))
      }
    } catch {
      toast.error(tErrors('generic'))
    } finally {
      setIsLoading(false)
      setDeleteDialogOpen(false)
      setProductToDelete(null)
    }
  }

  if (products.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-12">
        <Package className="h-12 w-12 text-muted-foreground" />
        <h3 className="mt-4 text-lg font-semibold">{t('noProducts')}</h3>
        <p className="mt-2 text-sm text-muted-foreground">
          {t('noProductsDescription')}
        </p>
        <Button asChild className="mt-4">
          <Link href="/dashboard/products/new">{t('addProduct')}</Link>
        </Button>
      </div>
    )
  }

  return (
    <>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[80px]">{t('images')}</TableHead>
              <TableHead>{t('name')}</TableHead>
              <TableHead>{t('category')}</TableHead>
              <TableHead className="text-right">{t('price')}</TableHead>
              <TableHead className="text-center">{t('quantity')}</TableHead>
              <TableHead>{tCommon('status')}</TableHead>
              <TableHead className="w-[70px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {products.map((product) => {
              const statusStyle = STATUS_STYLES[product.status || 'draft']

              return (
                <TableRow key={product.id}>
                  <TableCell>
                    <ProductImage
                      src={product.images?.[0]}
                      alt={product.name}
                    />
                  </TableCell>
                  <TableCell>
                    <Link
                      href={`/dashboard/products/${product.id}`}
                      className="font-medium hover:underline"
                    >
                      {product.name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {product.category?.name || '-'}
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {parseFloat(product.price).toFixed(2)} {currencySymbol}
                  </TableCell>
                  <TableCell className="text-center">
                    {product.quantity}
                  </TableCell>
                  <TableCell>
                    <Badge className={statusStyle}>
                      {t(`status.${product.status || 'draft'}`)}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          disabled={isLoading}
                        >
                          <MoreHorizontal className="h-4 w-4" />
                          <span className="sr-only">{tCommon('actions')}</span>
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem asChild>
                          <Link href={`/dashboard/products/${product.id}`}>
                            <Pencil className="mr-2 h-4 w-4" />
                            {tCommon('edit')}
                          </Link>
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => handleDuplicate(product)}
                        >
                          <Copy className="mr-2 h-4 w-4" />
                          {t('duplicate')}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          onClick={() => handleStatusToggle(product)}
                        >
                          {product.status === 'active' ? (
                            <>
                              <EyeOff className="mr-2 h-4 w-4" />
                              {t('unpublish')}
                            </>
                          ) : (
                            <>
                              <Eye className="mr-2 h-4 w-4" />
                              {t('publish')}
                            </>
                          )}
                        </DropdownMenuItem>
                        {product.status !== 'archived' && (
                          <DropdownMenuItem
                            onClick={() => handleArchive(product)}
                          >
                            <Archive className="mr-2 h-4 w-4" />
                            {t('archive')}
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onClick={() => {
                            setProductToDelete(product)
                            setDeleteDialogOpen(true)
                          }}
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
                          {tCommon('delete')}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('deleteConfirm.title')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('deleteConfirm.description')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{tCommon('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {tCommon('delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
