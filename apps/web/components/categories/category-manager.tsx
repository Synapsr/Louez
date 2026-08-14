'use client';

import { useMemo, useState } from 'react';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  FolderOpen,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react';
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
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Input,
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
  Label,
  Textarea,
  toastManager,
} from '@louez/ui';

import { DashboardIconTile } from '@/components/dashboard/shared/dashboard-icon-tile';
import {
  ImageUploadValidationError,
  useImageUpload,
} from '@/hooks/use-image-upload';
import { orpc } from '@/lib/orpc/react';
import { cn } from '@/lib/utils';

import { CategoryImageControl } from './category-image-control';

const KEEP_EXISTING_CATEGORIES_VALUE = '__keep_existing_categories__';

export interface CategoryManagerItem {
  id: string;
  name: string;
  description?: string | null;
  imageUrl?: string | null;
  productCount?: number;
}

interface CategoryManagerProps {
  initialCategories?: CategoryManagerItem[];
  variant?: 'page' | 'drawer';
  onCategoryDeleted?: (categoryId: string) => void;
}

export const CategoryManager = ({
  initialCategories,
  variant = 'page',
  onCategoryDeleted,
}: CategoryManagerProps) => {
  const t = useTranslations();
  const queryClient = useQueryClient();
  const categoryFiles = useImageUpload('category');
  const categoriesQuery = useQuery(
    orpc.dashboard.categories.list.queryOptions({
      initialData: initialCategories,
    }),
  );
  const categories = categoriesQuery.data ?? initialCategories ?? [];

  const [search, setSearch] = useState('');
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [newCategoryName, setNewCategoryName] = useState('');
  const [newCategoryDescription, setNewCategoryDescription] = useState('');
  const [newCategoryImageUrl, setNewCategoryImageUrl] = useState<string | null>(
    null,
  );
  const [editingCategory, setEditingCategory] =
    useState<CategoryManagerItem | null>(null);
  const [editCategoryName, setEditCategoryName] = useState('');
  const [editCategoryDescription, setEditCategoryDescription] = useState('');
  const [editCategoryImageUrl, setEditCategoryImageUrl] = useState<
    string | null
  >(null);
  const [categoryToDelete, setCategoryToDelete] =
    useState<CategoryManagerItem | null>(null);
  const [replacementCategoryId, setReplacementCategoryId] = useState(
    KEEP_EXISTING_CATEGORIES_VALUE,
  );

  const invalidateCategories = () =>
    queryClient.invalidateQueries({
      queryKey: orpc.dashboard.categories.key(),
    });

  const createMutation = useMutation(
    orpc.dashboard.categories.create.mutationOptions(),
  );
  const updateMutation = useMutation(
    orpc.dashboard.categories.update.mutationOptions(),
  );
  const deleteMutation = useMutation(
    orpc.dashboard.categories.delete.mutationOptions(),
  );
  const isMutating =
    createMutation.isPending ||
    updateMutation.isPending ||
    deleteMutation.isPending ||
    categoryFiles.isUploading;

  const deleteUploadedImage = (imageUrl: string) => {
    void categoryFiles.deleteImage(imageUrl).catch(() => undefined);
  };

  const closeCreateDialog = () => {
    if (newCategoryImageUrl) deleteUploadedImage(newCategoryImageUrl);
    setNewCategoryName('');
    setNewCategoryDescription('');
    setNewCategoryImageUrl(null);
    setCreateDialogOpen(false);
  };

  const closeEditDialog = () => {
    if (
      editCategoryImageUrl &&
      editCategoryImageUrl !== editingCategory?.imageUrl
    ) {
      deleteUploadedImage(editCategoryImageUrl);
    }
    setEditingCategory(null);
    setEditCategoryName('');
    setEditCategoryDescription('');
    setEditCategoryImageUrl(null);
  };

  const handleImageUpload = async (file: File, target: 'create' | 'edit') => {
    const currentImageUrl =
      target === 'create' ? newCategoryImageUrl : editCategoryImageUrl;
    const savedImageUrl = target === 'edit' ? editingCategory?.imageUrl : null;

    try {
      const uploaded = await categoryFiles.uploadImage(file);
      if (currentImageUrl && currentImageUrl !== savedImageUrl) {
        deleteUploadedImage(currentImageUrl);
      }
      if (target === 'create') {
        setNewCategoryImageUrl(uploaded.url);
      } else {
        setEditCategoryImageUrl(uploaded.url);
      }
    } catch (error) {
      toastManager.add({
        title:
          error instanceof ImageUploadValidationError
            ? t('errors.invalidData')
            : t('errors.generic'),
        type: 'error',
      });
    }
  };

  const removeCreateImage = () => {
    if (newCategoryImageUrl) deleteUploadedImage(newCategoryImageUrl);
    setNewCategoryImageUrl(null);
  };

  const removeEditImage = () => {
    if (
      editCategoryImageUrl &&
      editCategoryImageUrl !== editingCategory?.imageUrl
    ) {
      deleteUploadedImage(editCategoryImageUrl);
    }
    setEditCategoryImageUrl(null);
  };

  const filteredCategories = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase();
    if (!normalizedSearch) return categories;
    return categories.filter((category) =>
      category.name.toLocaleLowerCase().includes(normalizedSearch),
    );
  }, [categories, search]);

  const handleCreate = async () => {
    const name = newCategoryName.trim();
    const description = newCategoryDescription.trim() || null;
    if (name.length < 2) return;

    try {
      const created = await createMutation.mutateAsync({
        name,
        description,
        imageUrl: newCategoryImageUrl,
      });
      await invalidateCategories();
      queryClient.setQueryData(
        orpc.dashboard.categories.list.key({ type: 'query' }),
        (current: CategoryManagerItem[] | undefined) => {
          const latest = current ?? [];
          return latest.some((category) => category.id === created.id)
            ? latest
            : [...latest, created];
        },
      );
      if (newCategoryImageUrl && created.imageUrl !== newCategoryImageUrl) {
        deleteUploadedImage(newCategoryImageUrl);
      }
      setNewCategoryName('');
      setNewCategoryDescription('');
      setNewCategoryImageUrl(null);
      setCreateDialogOpen(false);
      toastManager.add({
        title: t('categories.categoryCreated'),
        type: 'success',
      });
    } catch {
      toastManager.add({ title: t('errors.generic'), type: 'error' });
    }
  };

  const handleEdit = async () => {
    const name = editCategoryName.trim();
    const description = editCategoryDescription.trim() || null;
    if (!editingCategory || name.length < 2) return;

    try {
      const updated = await updateMutation.mutateAsync({
        id: editingCategory.id,
        name,
        description,
        imageUrl: editCategoryImageUrl,
      });
      await invalidateCategories();
      queryClient.setQueryData(
        orpc.dashboard.categories.list.key({ type: 'query' }),
        (current: CategoryManagerItem[] | undefined) =>
          current?.map((category) =>
            category.id === updated.id ? { ...category, ...updated } : category,
          ),
      );
      if (
        editingCategory.imageUrl &&
        editingCategory.imageUrl !== updated.imageUrl
      ) {
        deleteUploadedImage(editingCategory.imageUrl);
      }
      setEditingCategory(null);
      setEditCategoryName('');
      setEditCategoryDescription('');
      setEditCategoryImageUrl(null);
      toastManager.add({
        title: t('categories.categoryUpdated'),
        type: 'success',
      });
    } catch {
      toastManager.add({ title: t('errors.generic'), type: 'error' });
    }
  };

  const handleDelete = async () => {
    if (!categoryToDelete) return;

    try {
      const deleted = await deleteMutation.mutateAsync({
        id: categoryToDelete.id,
        replacementCategoryId:
          replacementCategoryId === KEEP_EXISTING_CATEGORIES_VALUE
            ? null
            : replacementCategoryId,
      });
      await invalidateCategories();
      queryClient.setQueryData(
        orpc.dashboard.categories.list.key({ type: 'query' }),
        (current: CategoryManagerItem[] | undefined) =>
          current?.filter((category) => category.id !== deleted.id),
      );
      if (categoryToDelete.imageUrl) {
        deleteUploadedImage(categoryToDelete.imageUrl);
      }
      onCategoryDeleted?.(deleted.id);
      setCategoryToDelete(null);
      setReplacementCategoryId(KEEP_EXISTING_CATEGORIES_VALUE);
      toastManager.add({
        title: t('categories.categoryDeleted'),
        type: 'success',
      });
    } catch {
      toastManager.add({ title: t('errors.generic'), type: 'error' });
    }
  };

  const openEditDialog = (category: CategoryManagerItem) => {
    setEditingCategory(category);
    setEditCategoryName(category.name);
    setEditCategoryDescription(category.description ?? '');
    setEditCategoryImageUrl(category.imageUrl ?? null);
  };

  const openDeleteDialog = (category: CategoryManagerItem) => {
    setCategoryToDelete(category);
    setReplacementCategoryId(KEEP_EXISTING_CATEGORIES_VALUE);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t('categories.searchPlaceholder')}
          aria-label={t('categories.searchPlaceholder')}
          className="flex-1"
        />
        <Button type="button" onClick={() => setCreateDialogOpen(true)}>
          <Plus className="size-4" />
          {t('categories.newCategory')}
        </Button>
      </div>

      <div
        className={cn(
          'overflow-hidden rounded-xl border',
          variant === 'page' && 'bg-card shadow-sm',
        )}
      >
        <div className="bg-muted/40 flex items-center justify-between border-b px-4 py-3">
          <p className="text-sm font-medium">
            {t('categories.totalCount', { count: categories.length })}
          </p>
          {categoriesQuery.isFetching && (
            <Loader2 className="text-muted-foreground size-4 animate-spin" />
          )}
        </div>

        {categoriesQuery.isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="text-muted-foreground size-5 animate-spin" />
          </div>
        ) : filteredCategories.length === 0 ? (
          <div className="flex flex-col items-center px-6 py-12 text-center">
            <FolderOpen className="text-muted-foreground size-10" />
            <p className="mt-3 font-medium">
              {categories.length === 0
                ? t('categories.noCategories')
                : t('categories.noSearchResults')}
            </p>
            {categories.length === 0 && (
              <p className="text-muted-foreground mt-1 max-w-sm text-sm">
                {t('categories.emptyDescription')}
              </p>
            )}
          </div>
        ) : (
          <div className="divide-y">
            {filteredCategories.map((category) => (
              <div
                key={category.id}
                className="flex items-center justify-between gap-4 px-4 py-3"
              >
                <div className="flex min-w-0 items-center gap-3">
                  {category.imageUrl ? (
                    <img
                      src={category.imageUrl}
                      alt=""
                      className="size-10 shrink-0 rounded-lg border object-cover"
                    />
                  ) : (
                    <DashboardIconTile icon={FolderOpen} />
                  )}
                  <div className="min-w-0">
                    <p className="truncate font-medium">{category.name}</p>
                    <p className="text-muted-foreground text-sm">
                      {t('categories.productCount', {
                        count: category.productCount ?? 0,
                      })}
                    </p>
                  </div>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={t('categories.actionsFor', {
                          name: category.name,
                        })}
                      />
                    }
                  >
                    <MoreHorizontal className="size-4" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => openEditDialog(category)}>
                      <Pencil className="size-4" />
                      {t('common.edit')}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="text-destructive focus:text-destructive"
                      onClick={() => openDeleteDialog(category)}
                    >
                      <Trash2 className="size-4" />
                      {t('common.delete')}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            ))}
          </div>
        )}
      </div>

      <Dialog
        open={createDialogOpen}
        onOpenChange={(open) => {
          if (open) setCreateDialogOpen(true);
          else if (!categoryFiles.isUploading) closeCreateDialog();
        }}
      >
        <DialogPopup>
          <DialogHeader>
            <DialogTitle>{t('categories.newCategory')}</DialogTitle>
            <DialogDescription>
              {t('categories.newCategoryDescription')}
            </DialogDescription>
          </DialogHeader>
          <DialogPanel className="space-y-4">
            <Input
              autoFocus
              placeholder={t('categories.namePlaceholder')}
              value={newCategoryName}
              onChange={(event) => setNewCategoryName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void handleCreate();
                }
              }}
            />
            <div className="space-y-2">
              <Label htmlFor="new-category-description">
                {t('categories.categoryDescription')}
              </Label>
              <Textarea
                id="new-category-description"
                value={newCategoryDescription}
                onChange={(event) =>
                  setNewCategoryDescription(event.target.value)
                }
                rows={3}
              />
            </div>
            <CategoryImageControl
              imageUrl={newCategoryImageUrl}
              label={t('categories.image')}
              uploadLabel={t(
                newCategoryImageUrl
                  ? 'categories.changeImage'
                  : 'categories.addImage',
              )}
              removeLabel={t('categories.removeImage')}
              isUploading={categoryFiles.isUploading}
              onFileSelected={(file) => handleImageUpload(file, 'create')}
              onRemove={removeCreateImage}
            />
          </DialogPanel>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={closeCreateDialog}
              disabled={categoryFiles.isUploading}
            >
              {t('common.cancel')}
            </Button>
            <Button
              type="button"
              onClick={() => void handleCreate()}
              isPending={createMutation.isPending}
              disabled={isMutating}
            >
              {t('common.create')}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>

      <Dialog
        open={editingCategory !== null}
        onOpenChange={(open) => {
          if (!open && !categoryFiles.isUploading) closeEditDialog();
        }}
      >
        <DialogPopup>
          <DialogHeader>
            <DialogTitle>{t('categories.editCategory')}</DialogTitle>
            <DialogDescription>
              {t('categories.editCategoryDescription')}
            </DialogDescription>
          </DialogHeader>
          <DialogPanel className="space-y-4">
            <Input
              autoFocus
              placeholder={t('categories.namePlaceholder')}
              value={editCategoryName}
              onChange={(event) => setEditCategoryName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void handleEdit();
                }
              }}
            />
            <div className="space-y-2">
              <Label htmlFor="edit-category-description">
                {t('categories.categoryDescription')}
              </Label>
              <Textarea
                id="edit-category-description"
                value={editCategoryDescription}
                onChange={(event) =>
                  setEditCategoryDescription(event.target.value)
                }
                rows={3}
              />
            </div>
            <CategoryImageControl
              imageUrl={editCategoryImageUrl}
              label={t('categories.image')}
              uploadLabel={t(
                editCategoryImageUrl
                  ? 'categories.changeImage'
                  : 'categories.addImage',
              )}
              removeLabel={t('categories.removeImage')}
              isUploading={categoryFiles.isUploading}
              onFileSelected={(file) => handleImageUpload(file, 'edit')}
              onRemove={removeEditImage}
            />
          </DialogPanel>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={closeEditDialog}
              disabled={categoryFiles.isUploading}
            >
              {t('common.cancel')}
            </Button>
            <Button
              type="button"
              onClick={() => void handleEdit()}
              isPending={updateMutation.isPending}
              disabled={isMutating}
            >
              {t('common.save')}
            </Button>
          </DialogFooter>
        </DialogPopup>
      </Dialog>

      <AlertDialog
        open={categoryToDelete !== null}
        onOpenChange={(open) => {
          if (!open) setCategoryToDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('categories.deleteConfirm.title')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('categories.deleteConfirm.descriptionWithName', {
                name: categoryToDelete?.name ?? '',
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>

          {categoryToDelete && (categoryToDelete.productCount ?? 0) > 0 && (
            <div className="space-y-3">
              <p className="text-muted-foreground text-sm">
                {t('categories.deleteConfirm.productsWarning', {
                  count: categoryToDelete.productCount ?? 0,
                })}
              </p>
              <div className="space-y-2">
                <p className="text-sm font-medium">
                  {t('categories.deleteConfirm.reassignLabel')}
                </p>
                <Select
                  value={replacementCategoryId}
                  onValueChange={(value) => {
                    if (value !== null) setReplacementCategoryId(value);
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectPopup>
                    <SelectItem value={KEEP_EXISTING_CATEGORIES_VALUE}>
                      {t('categories.deleteConfirm.keepExisting')}
                    </SelectItem>
                    {categories
                      .filter((category) => category.id !== categoryToDelete.id)
                      .map((category) => (
                        <SelectItem key={category.id} value={category.id}>
                          {category.name}
                        </SelectItem>
                      ))}
                  </SelectPopup>
                </Select>
              </div>
            </div>
          )}

          <AlertDialogFooter>
            <AlertDialogClose
              render={<Button type="button" variant="outline" />}
            >
              {t('common.cancel')}
            </AlertDialogClose>
            <Button
              type="button"
              variant="destructive"
              onClick={() => void handleDelete()}
              isPending={deleteMutation.isPending}
              disabled={isMutating}
            >
              {t('common.delete')}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};
