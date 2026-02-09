'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslations } from 'next-intl'
import {
  Plus,
  MoreHorizontal,
  Pencil,
  Trash2,
  FolderOpen,
  Loader2,
} from 'lucide-react'
import { toastManager } from '@louez/ui'

import { Button } from '@louez/ui'
import { Input } from '@louez/ui'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@louez/ui'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@louez/ui'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@louez/ui'
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@louez/ui'

import { createCategory, updateCategory, deleteCategory } from '../products/actions'

interface Category {
  id: string
  name: string
  description: string | null
  productCount: number
}

interface CategoriesListProps {
  categories: Category[]
}

export function CategoriesList({ categories }: CategoriesListProps) {
  const router = useRouter()
  const t = useTranslations('categories')
  const tCommon = useTranslations('common')
  const tErrors = useTranslations('errors')
  const [isLoading, setIsLoading] = useState(false)

  // Create dialog
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [newCategoryName, setNewCategoryName] = useState('')

  // Edit dialog
  const [editDialogOpen, setEditDialogOpen] = useState(false)
  const [editingCategory, setEditingCategory] = useState<Category | null>(null)
  const [editCategoryName, setEditCategoryName] = useState('')

  // Delete dialog
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [categoryToDelete, setCategoryToDelete] = useState<Category | null>(null)

  const handleCreate = async () => {
    if (!newCategoryName.trim()) return

    setIsLoading(true)
    try {
      const result = await createCategory({ name: newCategoryName.trim() })
      if (result.error) {
        toastManager.add({ title: result.error, type: 'error' })
      } else {
        toastManager.add({ title: t('categoryCreated'), type: 'success' })
        setNewCategoryName('')
        setCreateDialogOpen(false)
        router.refresh()
      }
    } catch {
      toastManager.add({ title: tErrors('generic'), type: 'error' })
    } finally {
      setIsLoading(false)
    }
  }

  const handleEdit = async () => {
    if (!editingCategory || !editCategoryName.trim()) return

    setIsLoading(true)
    try {
      const result = await updateCategory(editingCategory.id, {
        name: editCategoryName.trim(),
      })
      if (result.error) {
        toastManager.add({ title: result.error, type: 'error' })
      } else {
        toastManager.add({ title: t('categoryUpdated'), type: 'success' })
        setEditDialogOpen(false)
        setEditingCategory(null)
        router.refresh()
      }
    } catch {
      toastManager.add({ title: tErrors('generic'), type: 'error' })
    } finally {
      setIsLoading(false)
    }
  }

  const handleDelete = async () => {
    if (!categoryToDelete) return

    setIsLoading(true)
    try {
      const result = await deleteCategory(categoryToDelete.id)
      if (result.error) {
        toastManager.add({ title: result.error, type: 'error' })
      } else {
        toastManager.add({ title: t('categoryDeleted'), type: 'success' })
        setDeleteDialogOpen(false)
        setCategoryToDelete(null)
        router.refresh()
      }
    } catch {
      toastManager.add({ title: tErrors('generic'), type: 'error' })
    } finally {
      setIsLoading(false)
    }
  }

  const openEditDialog = (category: Category) => {
    setEditingCategory(category)
    setEditCategoryName(category.name)
    setEditDialogOpen(true)
  }

  const openDeleteDialog = (category: Category) => {
    setCategoryToDelete(category)
    setDeleteDialogOpen(true)
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>{t('yourCategories')}</CardTitle>
            <CardDescription>
              {categories.length === 0
                ? t('noCategoriesDescription')
                : t('productCount', { count: categories.length })}
            </CardDescription>
          </div>
          <Button onClick={() => setCreateDialogOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            {t('newCategory')}
          </Button>
        </CardHeader>
        <CardContent>
          {categories.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-12">
              <FolderOpen className="h-12 w-12 text-muted-foreground" />
              <h3 className="mt-4 text-lg font-semibold">{t('noCategories')}</h3>
              <p className="mt-2 text-sm text-muted-foreground text-center max-w-sm">
                {t('emptyDescription')}
              </p>
              <Button
                className="mt-4"
                onClick={() => setCreateDialogOpen(true)}
              >
                {t('createCategory')}
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              {categories.map((category) => (
                <div
                  key={category.id}
                  className="flex items-center justify-between rounded-lg border p-4"
                >
                  <div className="flex items-center gap-4">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                      <FolderOpen className="h-5 w-5 text-muted-foreground" />
                    </div>
                    <div>
                      <p className="font-medium">{category.name}</p>
                      <p className="text-sm text-muted-foreground">
                        {t('productCount', { count: category.productCount })}
                      </p>
                    </div>
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger render={<Button variant="ghost" size="icon" />}>
                      <MoreHorizontal className="h-4 w-4" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => openEditDialog(category)}>
                        <Pencil className="mr-2 h-4 w-4" />
                        {tCommon('edit')}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="text-destructive focus:text-destructive"
                        onClick={() => openDeleteDialog(category)}
                      >
                        <Trash2 className="mr-2 h-4 w-4" />
                        {tCommon('delete')}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create Dialog */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('newCategory')}</DialogTitle>
            <DialogDescription>
              {t('newCategoryDescription')}
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Input
              placeholder={t('namePlaceholder')}
              value={newCategoryName}
              onChange={(e) => setNewCategoryName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleCreate()
                }
              }}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCreateDialogOpen(false)}
            >
              {tCommon('cancel')}
            </Button>
            <Button onClick={handleCreate} disabled={isLoading}>
              {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {tCommon('create')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('editCategory')}</DialogTitle>
            <DialogDescription>
              {t('editCategoryDescription')}
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Input
              placeholder={t('namePlaceholder')}
              value={editCategoryName}
              onChange={(e) => setEditCategoryName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleEdit()
                }
              }}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialogOpen(false)}>
              {tCommon('cancel')}
            </Button>
            <Button onClick={handleEdit} disabled={isLoading}>
              {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {tCommon('save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Dialog */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('deleteConfirm.title')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('deleteConfirm.descriptionWithName', { name: categoryToDelete?.name ?? '' })}
              {categoryToDelete && categoryToDelete.productCount > 0 && (
                <span className="block mt-2 text-orange-600">
                  {t('deleteConfirm.productsWarning', { count: categoryToDelete.productCount })}
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogClose render={<Button variant="outline" />}>{tCommon('cancel')}</AlertDialogClose>
            <AlertDialogClose
              render={<Button variant="destructive" />}
              onClick={handleDelete}
            >
              {tCommon('delete')}
            </AlertDialogClose>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
