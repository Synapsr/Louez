'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

import { useTranslations } from 'next-intl';
import {
  Archive,
  ArrowLeft,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  MoreHorizontal,
  Pencil,
  Trash2,
} from 'lucide-react';

import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@louez/ui';

import { ProductImage } from '@/components/product/product-image';

import { useProductActions } from '../hooks/use-product-actions';

const STATUS_VARIANTS = {
  active: 'success',
  draft: 'pending',
  archived: 'expired',
} as const

/**
 * True once the observed element has fully scrolled out of view. Drives the
 * compact sticky bar, which lives outside the flow so toggling it never
 * changes the page height (a height change would shift the scroll position
 * and re-trigger the observer, producing a flicker loop).
 */
function useIsScrolledOut(ref: React.RefObject<HTMLElement | null>) {
  const [isScrolledOut, setIsScrolledOut] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const observer = new IntersectionObserver(([entry]) => {
      setIsScrolledOut(entry ? !entry.isIntersecting : false);
    });
    observer.observe(element);

    return () => observer.disconnect();
  }, [ref]);

  return isScrolledOut;
}

interface ProductHeaderProps {
  product: {
    id: string;
    name: string;
    images: string[] | null;
    status: 'draft' | 'active' | 'archived' | null;
    categories: Array<{ id: string; name: string }>;
  };
  storeSlug: string;
  readOnly?: boolean;
  onBack?: () => void;
}

export const ProductHeader = ({ product, storeSlug, readOnly = false, onBack }: ProductHeaderProps) => {
  const headerRef = useRef<HTMLDivElement>(null);
  const t = useTranslations('dashboard.products');
  const tDetail = useTranslations('dashboard.products.detail');
  const tCommon = useTranslations('common');

  const {
    isLoading,
    deleteDialogOpen,
    setDeleteDialogOpen,
    handleStatusToggle,
    handleArchive,
    handleDuplicate,
    requestDelete,
    handleDelete,
  } = useProductActions({ readOnly });

  const status = product.status || 'draft';
  const image = product.images?.[0];
  const isHeaderScrolledOut = useIsScrolledOut(headerRef);
  const editHref = `/dashboard/products/${product.id}/edit`;

  const actionsMenu = (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="outline" size="icon" disabled={readOnly || isLoading} />}
      >
        <MoreHorizontal className="h-4 w-4" />
        <span className="sr-only">{tCommon('actions')}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem disabled={readOnly} render={readOnly ? undefined : <Link href={editHref} />}>
          <Pencil className="mr-2 h-4 w-4" />
          {tCommon('edit')}
        </DropdownMenuItem>
        {status === 'active' && (
          <DropdownMenuItem
            onClick={() =>
              window.open(`/${storeSlug}/product/${product.id}`, '_blank')
            }
          >
            <ExternalLink className="mr-2 h-4 w-4" />
            {tDetail('viewOnStorefront')}
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onClick={() => handleDuplicate(product)}>
          <Copy className="mr-2 h-4 w-4" />
          {t('duplicate')}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => handleStatusToggle(product)}>
          {status === 'active' ? (
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
        {status !== 'archived' && (
          <DropdownMenuItem onClick={() => handleArchive(product)}>
            <Archive className="mr-2 h-4 w-4" />
            {t('archive')}
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="text-destructive focus:text-destructive"
          onClick={() => requestDelete(product)}
        >
          <Trash2 className="mr-2 h-4 w-4" />
          {tCommon('delete')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <>
      {/* Compact sticky bar. The wrapper is zero-height and sticks to the top
          of the dashboard scroll area; negative margins cancel the layout
          padding so the bar spans the full content width, flush with the top.
          `z-40` keeps it above the timeline's own sticky header (`z-30`). */}
      <div className="sticky top-0 z-40 -mx-4 -mt-4 h-0 sm:-mx-6 sm:-mt-6 lg:-mx-8">
        <div
          hidden={!isHeaderScrolledOut}
          className="bg-background flex items-center gap-2 border-b px-4 py-2 shadow-xs sm:px-6 lg:px-8"
        >
          <Button
            disabled={readOnly && !onBack}
            onClick={onBack}
            render={readOnly || onBack ? undefined : <Link href="/dashboard/products" />}
            variant="ghost"
            size="icon"
            className="-ml-2 shrink-0"
          >
            <ArrowLeft className="h-4 w-4" />
            <span className="sr-only">{tCommon('back')}</span>
          </Button>
          <h2 className="min-w-0 flex-1 truncate text-base font-semibold">
            {product.name}
          </h2>
          <div className="flex shrink-0 items-center gap-2">
            <Button disabled={readOnly} render={readOnly ? undefined : <Link href={editHref} />}>
              <Pencil className="mr-2 h-4 w-4" />
              {tCommon('edit')}
            </Button>
            {actionsMenu}
          </div>
        </div>
      </div>

      <div
        ref={headerRef}
        className="flex flex-col gap-3 border-b pb-4 sm:flex-row sm:items-start sm:justify-between sm:gap-4 sm:pb-6"
      >
        <div className="flex min-w-0 items-start gap-2 sm:gap-3">
          <Button
            disabled={readOnly && !onBack}
            onClick={onBack}
            render={readOnly || onBack ? undefined : <Link href="/dashboard/products" />}
            variant="ghost"
            size="icon"
            className="shrink-0 -ml-2 mt-0.5"
          >
            <ArrowLeft className="h-4 w-4" />
            <span className="sr-only">{tCommon('back')}</span>
          </Button>

          <ProductImage
            src={image}
            alt={product.name}
            sizes="56px"
            containerClassName="aspect-square size-11 shrink-0 sm:size-14"
          />

          <div className="min-w-0 flex-1 space-y-1.5">
            <h1 className="text-lg font-bold tracking-tight wrap-break-word sm:text-2xl">
              {product.name}
            </h1>
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge variant={STATUS_VARIANTS[status]}>{t(`status.${status}`)}</Badge>
              {product.categories.map((category) => (
                <Badge key={category.id} variant="expired" className="font-normal">
                  {category.name}
                </Badge>
              ))}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 sm:shrink-0">
          <Button className="flex-1 sm:flex-none" disabled={readOnly} render={readOnly ? undefined : <Link href={editHref} />}>
            <Pencil className="h-4 w-4 mr-2" />
            {tCommon('edit')}
          </Button>
          {actionsMenu}
        </div>
      </div>

      {!readOnly && <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('deleteConfirm.title')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('deleteConfirm.description')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>
              {tCommon('cancel')}
            </AlertDialogClose>
            <AlertDialogClose
              render={<Button variant="destructive" />}
              onClick={() =>
                handleDelete({ redirectTo: '/dashboard/products' })
              }
            >
              {tCommon('delete')}
            </AlertDialogClose>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>}
    </>
  );
}
