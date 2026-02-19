'use client'

import type { ChangeEvent } from 'react'

import { Loader2, Plus } from 'lucide-react'
import { useTranslations } from 'next-intl'

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogPanel,
  DialogPopup,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@louez/ui'

import { RichTextEditor } from '@/components/ui/rich-text-editor'
import { getFieldError } from '@/hooks/form/form-context'

import type { Category, ProductFormComponentApi } from '../types'

interface ProductFormStepInfoProps {
  form: ProductFormComponentApi
  categories: Category[]
  categoryDialogOpen: boolean
  newCategoryName: string
  setNewCategoryName: (value: string) => void
  onCategoryDialogOpenChange: (open: boolean) => void
  onCreateCategory: () => void
  isCreatingCategory: boolean
  onNameInputChange?: (event: ChangeEvent<HTMLInputElement>, handleChange: (value: string) => void) => void
}

export function ProductFormStepInfo({
  form,
  categories,
  categoryDialogOpen,
  newCategoryName,
  setNewCategoryName,
  onCategoryDialogOpenChange,
  onCreateCategory,
  isCreatingCategory,
  onNameInputChange,
}: ProductFormStepInfoProps) {
  const t = useTranslations('dashboard.products.form')
  const tCommon = useTranslations('common')

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('information')}</CardTitle>
        <CardDescription>{t('informationDescription')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <form.AppField name="name">
          {(field) => (
            <field.Input
              label={t('name')}
              placeholder={t('namePlaceholder')}
              onChange={(event: ChangeEvent<HTMLInputElement>) => {
                if (onNameInputChange) {
                  onNameInputChange(event, field.handleChange)
                  return
                }

                field.handleChange(event.target.value)
              }}
            />
          )}
        </form.AppField>

        <form.Field name="description">
          {(field) => (
            <div className="space-y-2">
              <Label>{t('description')}</Label>
              <RichTextEditor
                value={field.state.value || ''}
                onChange={field.handleChange}
                placeholder={t('descriptionPlaceholder')}
              />
              <p className="text-muted-foreground text-sm">{t('descriptionHint')}</p>
              {field.state.meta.errors.length > 0 && (
                <p className="text-destructive text-sm font-medium">
                  {getFieldError(field.state.meta.errors[0])}
                </p>
              )}
            </div>
          )}
        </form.Field>

        <form.Field name="categoryId">
          {(field) => (
            <div className="space-y-2">
              <Label>{t('category')}</Label>
              <Dialog
                open={categoryDialogOpen}
                onOpenChange={onCategoryDialogOpenChange}
              >
                {categories.length > 0 ? (
                  <div className="flex gap-2">
                    <Select
                      onValueChange={(value) => {
                        if (value !== null) field.handleChange(value)
                      }}
                      value={field.state.value || undefined}
                    >
                      <SelectTrigger className="flex-1">
                        <SelectValue placeholder={t('selectCategory')}>
                          {categories.find((category) => category.id === field.state.value)?.name}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {categories.map((category) => (
                          <SelectItem key={category.id} value={category.id}>
                            {category.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <DialogTrigger
                      render={
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                        />
                      }
                    >
                      <Plus className="h-4 w-4" />
                    </DialogTrigger>
                  </div>
                ) : (
                  <div className="flex items-center gap-3 rounded-lg border border-dashed p-3">
                    <p className="text-muted-foreground flex-1 text-sm">{t('noCategories')}</p>
                    <DialogTrigger
                      render={
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                        />
                      }
                    >
                      <Plus className="mr-2 h-4 w-4" />
                      {tCommon('create')}
                    </DialogTrigger>
                  </div>
                )}
                <DialogPopup>
                  <DialogHeader>
                    <DialogTitle>{t('newCategory')}</DialogTitle>
                    <DialogDescription>
                      {t('newCategoryDescription')}
                    </DialogDescription>
                  </DialogHeader>
                  <DialogPanel>
                    <div className="py-4">
                      <Input
                        placeholder={t('categoryName')}
                        value={newCategoryName}
                        onChange={(event) => setNewCategoryName(event.target.value)}
                      />
                    </div>
                  </DialogPanel>
                  <DialogFooter>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => onCategoryDialogOpenChange(false)}
                    >
                      {tCommon('cancel')}
                    </Button>
                    <Button
                      type="button"
                      onClick={onCreateCategory}
                      disabled={isCreatingCategory}
                    >
                      {isCreatingCategory && (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      )}
                      {tCommon('create')}
                    </Button>
                  </DialogFooter>
                </DialogPopup>
              </Dialog>
              <p className="text-muted-foreground text-sm">{t('categoryOptional')}</p>
              {field.state.meta.errors.length > 0 && (
                <p className="text-destructive text-sm font-medium">
                  {getFieldError(field.state.meta.errors[0])}
                </p>
              )}
            </div>
          )}
        </form.Field>
      </CardContent>
    </Card>
  )
}
