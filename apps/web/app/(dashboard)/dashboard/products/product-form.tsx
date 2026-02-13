'use client';

import { useCallback, useMemo, useState } from 'react';

import { useRouter } from 'next/navigation';

import { revalidateLogic, useStore } from '@tanstack/react-form';
import { ArrowLeft, ArrowRight, Check, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';

import type { PricingMode } from '@louez/types';
import { toastManager } from '@louez/ui';
import { Button } from '@louez/ui';
import { Card, CardContent } from '@louez/ui';
import { StepActions, StepContent, Stepper } from '@louez/ui';
import { getCurrencySymbol } from '@louez/utils';
import {
  type PricingTierInput,
  type ProductUnitInput,
  createProductSchema,
} from '@louez/validations';

import { FloatingSaveBar } from '@/components/dashboard/floating-save-bar';

import { useAppForm } from '@/hooks/form/form';

import { ProductFormStepInfo } from './components/product-form-step-info';
import { ProductFormStepPhotos } from './components/product-form-step-photos';
import { ProductFormStepPreview } from './components/product-form-step-preview';
import { ProductFormStepPricing } from './components/product-form-step-pricing';
import { ProductImageCropDialog } from './components/product-image-crop-dialog';
import { useProductFormMedia } from './hooks/use-product-form-media';
import { useProductFormMutations } from './hooks/use-product-form-mutations';
import { useProductFormStepFlow } from './hooks/use-product-form-step-flow';
import type {
  BookingAttributeAxisData,
  ProductFormComponentApi,
  ProductFormProps,
} from './types';

export function ProductForm({
  product,
  categories,
  currency = 'EUR',
  storeTaxSettings,
  availableAccessories = [],
}: ProductFormProps) {
  const router = useRouter();
  const t = useTranslations('dashboard.products.form');
  const tCommon = useTranslations('common');
  const tValidation = useTranslations('validation');
  const currencySymbol = getCurrencySymbol(currency);

  const isEditMode = !!product;
  const [newCategoryName, setNewCategoryName] = useState('');
  const [categoryDialogOpen, setCategoryDialogOpen] = useState(false);
  const {
    isSaving,
    isCreatingCategory,
    submitProduct,
    createCategoryByName,
    getActionErrorMessage,
  } = useProductFormMutations({
    productId: product?.id,
  });

  // Convert product pricing tiers to input format
  const initialPricingTiers: PricingTierInput[] =
    product?.pricingTiers?.map((tier) => ({
      id: tier.id,
      minDuration: tier.minDuration,
      discountPercent: parseFloat(tier.discountPercent),
    })) ?? [];

  // Convert product units to input format
  const initialUnits: ProductUnitInput[] =
    product?.units?.map((unit) => ({
      id: unit.id,
      identifier: unit.identifier,
      notes: unit.notes || '',
      status: unit.status,
      attributes: unit.attributes || {},
    })) ?? [];

  const initialBookingAttributeAxes: BookingAttributeAxisData[] =
    product?.bookingAttributeAxes?.map((axis, index) => ({
      key: axis.key,
      label: axis.label,
      position: axis.position ?? index,
    })) ?? [];

  const productFormSchema = useMemo(
    () => createProductSchema(tValidation),
    [tValidation],
  );

  const form = useAppForm({
    defaultValues: {
      name: product?.name || '',
      description: product?.description || '',
      categoryId: product?.categoryId ?? null,
      price: product?.price || '',
      deposit: product?.deposit ?? '',
      quantity: product?.quantity != null ? product.quantity.toString() : '1',
      status: (product?.status ?? 'draft') as 'draft' | 'active' | 'archived',
      images: product?.images ?? [],
      pricingMode: (product?.pricingMode ?? 'day') as PricingMode,
      pricingTiers: initialPricingTiers,
      enforceStrictTiers: product?.enforceStrictTiers || false,
      taxSettings: product?.taxSettings ?? { inheritFromStore: true },
      videoUrl: product?.videoUrl || '',
      accessoryIds: product?.accessoryIds ?? [],
      trackUnits: product?.trackUnits || false,
      units: initialUnits,
      bookingAttributeAxes: initialBookingAttributeAxes,
    },
    validationLogic: revalidateLogic({
      mode: 'submit',
      modeAfterSubmission: 'change',
    }),
    validators: { onSubmit: productFormSchema },
    onSubmit: async ({ value }) => {
      try {
        await submitProduct(value);

        toastManager.add({
          title: product ? t('productUpdated') : t('productCreated'),
          type: 'success',
        });
        router.push('/dashboard/products');
      } catch (error) {
        toastManager.add({
          title: getActionErrorMessage(error),
          type: 'error',
        });
      }
    },
  });

  const watchedValues = useStore(form.store, (s) => s.values);
  const isDirty = useStore(form.store, (s) => s.isDirty);
  const imagesPreviews = useStore(form.store, (s) => s.values.images ?? []);
  const media = useProductFormMedia({
    form: form as unknown as ProductFormComponentApi,
    imagesPreviews,
  });

  const handleReset = useCallback(() => {
    form.reset();
  }, [form]);

  const handleCreateCategory = async () => {
    const name = newCategoryName.trim();
    if (!name) return;

    try {
      await createCategoryByName(name);
      toastManager.add({ title: t('categoryCreated'), type: 'success' });
      setNewCategoryName('');
      setCategoryDialogOpen(false);
      router.refresh();
    } catch (error) {
      toastManager.add({ title: getActionErrorMessage(error), type: 'error' });
    }
  };

  const setSubmitError = useCallback(
    (name: 'name' | 'price' | 'quantity', message: string) => {
      form.setFieldMeta(name, (prev) => ({
        ...prev,
        isTouched: true,
        errorMap: {
          ...prev?.errorMap,
          onSubmit: message,
        },
      }));
    },
    [form],
  );

  const clearSubmitError = useCallback(
    (name: 'name' | 'price' | 'quantity') => {
      form.setFieldMeta(name, (prev) => ({
        ...prev,
        errorMap: {
          ...prev?.errorMap,
          onSubmit: undefined,
        },
      }));
    },
    [form],
  );

  const validateCurrentStep = useCallback(
    (step: number) => {
      const nameValue = watchedValues.name ?? '';
      const priceValue = watchedValues.price ?? '';
      const quantityValue = watchedValues.quantity ?? '';

      let isValid = true;

      if (step === 1) {
        const trimmed = nameValue.trim();
        if (!trimmed) {
          setSubmitError('name', tValidation('required'));
          isValid = false;
        } else if (trimmed.length < 2) {
          setSubmitError('name', tValidation('minLength', { min: 2 }));
          isValid = false;
        } else {
          clearSubmitError('name');
        }
      }

      if (step === 2) {
        if (!priceValue.trim()) {
          setSubmitError('price', tValidation('required'));
          isValid = false;
        } else if (!/^\d+([.,]\d{1,2})?$/.test(priceValue.trim())) {
          setSubmitError('price', tValidation('positive'));
          isValid = false;
        } else {
          clearSubmitError('price');
        }

        if (!quantityValue.trim()) {
          setSubmitError('quantity', tValidation('required'));
          isValid = false;
        } else if (!/^\d+$/.test(quantityValue.trim())) {
          setSubmitError('quantity', tValidation('integer'));
          isValid = false;
        } else {
          clearSubmitError('quantity');
        }
      }

      return isValid;
    },
    [clearSubmitError, setSubmitError, tValidation, watchedValues],
  );

  const {
    steps,
    currentStep,
    stepDirection,
    goToNextStep,
    goToPreviousStep,
    goToStep,
  } = useProductFormStepFlow({
    validateCurrentStep,
  });

  const selectedCategory = categories.find(
    (c) => c.id === watchedValues.categoryId,
  );

  const effectivePricingMode: PricingMode = watchedValues.pricingMode;

  const priceLabel =
    effectivePricingMode === 'day'
      ? t('pricePerDay')
      : effectivePricingMode === 'hour'
        ? t('pricePerHour')
        : t('pricePerWeek');
  const cropPreviewProductName =
    watchedValues.name.trim() || t('namePlaceholder');
  const cropPreviewPrice = watchedValues.price.trim()
    ? `${currencySymbol}${watchedValues.price.trim().replace(',', '.')}`
    : `${currencySymbol}0.00`;

  // Parse base price for the pricing tiers editor
  const basePrice =
    parseFloat(watchedValues.price?.replace(',', '.') || '0') || 0;

  // Edit mode: simple form without stepper
  if (isEditMode) {
    return (
      <>
        <form.AppForm>
          <form.Form className="space-y-6">
            <ProductFormStepPhotos
              form={form as unknown as ProductFormComponentApi}
              imagesPreviews={imagesPreviews}
              isDragging={media.isDragging}
              isUploadingImages={media.isUploadingImages}
              handleImageUpload={media.handleImageUpload}
              handleDragOver={media.handleDragOver}
              handleDragEnter={media.handleDragEnter}
              handleDragLeave={media.handleDragLeave}
              handleDrop={media.handleDrop}
              removeImage={media.removeImage}
              setMainImage={media.setMainImage}
              recropImage={media.recropImage}
              canRecrop={true}
            />

            <ProductFormStepInfo
              form={form as unknown as ProductFormComponentApi}
              categories={categories}
              categoryDialogOpen={categoryDialogOpen}
              newCategoryName={newCategoryName}
              setNewCategoryName={setNewCategoryName}
              onCategoryDialogOpenChange={setCategoryDialogOpen}
              onCreateCategory={handleCreateCategory}
              isCreatingCategory={isCreatingCategory}
              onNameInputChange={(event, handleChange) => {
                form.setFieldMeta('name', (prev) => ({
                  ...prev,
                  errorMap: { ...prev?.errorMap, onSubmit: undefined },
                }));
                handleChange(event.target.value);
              }}
            />

            <ProductFormStepPricing
              form={form as unknown as ProductFormComponentApi}
              watchedValues={watchedValues}
              priceLabel={priceLabel}
              currency={currency}
              currencySymbol={currencySymbol}
              isSaving={isSaving}
              storeTaxSettings={storeTaxSettings}
              availableAccessories={availableAccessories}
              basePrice={basePrice}
              effectivePricingMode={effectivePricingMode}
              showAccessories={true}
            />

            <FloatingSaveBar
              isDirty={isDirty}
              isLoading={isSaving}
              onReset={handleReset}
            />
          </form.Form>
        </form.AppForm>

        <ProductImageCropDialog
          open={media.isCropDialogOpen}
          items={media.cropQueueItems}
          selectedIndex={media.selectedCropIndex}
          previewProductName={cropPreviewProductName}
          previewPrice={cropPreviewPrice}
          previewPriceLabel={priceLabel}
          canGoToPrevious={media.canGoToPreviousCropItem}
          canGoToNext={media.canGoToNextCropItem}
          isUploading={media.isUploadingImages}
          onClose={media.closeCropDialog}
          onSelectIndex={media.setSelectedCropIndex}
          onPrevious={media.goToPreviousCropItem}
          onNext={media.goToNextCropItem}
          onCropChange={media.setCropRect}
          onCropComplete={media.setCropAreaPixels}
          onCropSizeChange={media.setCropSizePercent}
          onApplyCrop={media.applyCurrentCropAndProceed}
          onSkipCrop={media.keepCurrentCropOriginalAndProceed}
          onReplaceCurrentImage={media.replaceCurrentCropImage}
        />
      </>
    );
  }

  // Create mode: stepper flow
  return (
    <>
      <form.AppForm>
        <form.Form className="space-y-6">
          {/* Stepper */}
          <Card>
            <CardContent className="pt-6">
              <Stepper
                steps={steps}
                currentStep={currentStep}
                onStepClick={goToStep}
              />
            </CardContent>
          </Card>

          {/* Step Content */}
          {currentStep === 0 && (
            <StepContent direction={stepDirection}>
              <ProductFormStepPhotos
                form={form as unknown as ProductFormComponentApi}
                imagesPreviews={imagesPreviews}
                isDragging={media.isDragging}
                isUploadingImages={media.isUploadingImages}
                handleImageUpload={media.handleImageUpload}
                handleDragOver={media.handleDragOver}
                handleDragEnter={media.handleDragEnter}
                handleDragLeave={media.handleDragLeave}
                handleDrop={media.handleDrop}
                removeImage={media.removeImage}
                setMainImage={media.setMainImage}
                recropImage={media.recropImage}
                canRecrop={false}
              />
            </StepContent>
          )}

          {currentStep === 1 && (
            <StepContent direction={stepDirection}>
              <ProductFormStepInfo
                form={form as unknown as ProductFormComponentApi}
                categories={categories}
                categoryDialogOpen={categoryDialogOpen}
                newCategoryName={newCategoryName}
                setNewCategoryName={setNewCategoryName}
                onCategoryDialogOpenChange={setCategoryDialogOpen}
                onCreateCategory={handleCreateCategory}
                isCreatingCategory={isCreatingCategory}
                onNameInputChange={(event, handleChange) => {
                  form.setFieldMeta('name', (prev) => ({
                    ...prev,
                    errorMap: { ...prev?.errorMap, onSubmit: undefined },
                  }));
                  handleChange(event.target.value);
                }}
              />
            </StepContent>
          )}

          {currentStep === 2 && (
            <StepContent direction={stepDirection}>
              <ProductFormStepPricing
                form={form as unknown as ProductFormComponentApi}
                watchedValues={watchedValues}
                priceLabel={priceLabel}
                currency={currency}
                currencySymbol={currencySymbol}
                isSaving={isSaving}
                storeTaxSettings={storeTaxSettings}
                availableAccessories={availableAccessories}
                basePrice={basePrice}
                effectivePricingMode={effectivePricingMode}
                showAccessories={false}
              />
            </StepContent>
          )}

          {currentStep === 3 && (
            <StepContent direction={stepDirection}>
              <ProductFormStepPreview
                form={form as unknown as ProductFormComponentApi}
                watchedValues={watchedValues}
                imagesPreviews={imagesPreviews}
                selectedCategory={selectedCategory}
                priceLabel={priceLabel}
              />
            </StepContent>
          )}

          {/* Navigation */}
          <StepActions>
            <div>
              {currentStep > 0 ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={goToPreviousStep}
                >
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  {t('previous')}
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => router.push('/dashboard/products')}
                >
                  {tCommon('cancel')}
                </Button>
              )}
            </div>

            <div className="flex gap-3">
              {currentStep < steps.length - 1 ? (
                <Button key="next" type="button" onClick={goToNextStep}>
                  {t('next')}
                  <ArrowRight className="ml-2 h-4 w-4" />
                </Button>
              ) : (
                <Button key="submit" type="submit" disabled={isSaving}>
                  {isSaving && (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  )}
                  <Check className="mr-2 h-4 w-4" />
                  {product ? t('save') : t('createProduct')}
                </Button>
              )}
            </div>
          </StepActions>
        </form.Form>
      </form.AppForm>

      <ProductImageCropDialog
        open={media.isCropDialogOpen}
        items={media.cropQueueItems}
        selectedIndex={media.selectedCropIndex}
        previewProductName={cropPreviewProductName}
        previewPrice={cropPreviewPrice}
        previewPriceLabel={priceLabel}
        canGoToPrevious={media.canGoToPreviousCropItem}
        canGoToNext={media.canGoToNextCropItem}
        isUploading={media.isUploadingImages}
        onClose={media.closeCropDialog}
        onSelectIndex={media.setSelectedCropIndex}
        onPrevious={media.goToPreviousCropItem}
        onNext={media.goToNextCropItem}
        onCropChange={media.setCropRect}
        onCropComplete={media.setCropAreaPixels}
        onCropSizeChange={media.setCropSizePercent}
        onApplyCrop={media.applyCurrentCropAndProceed}
        onSkipCrop={media.keepCurrentCropOriginalAndProceed}
        onReplaceCurrentImage={media.replaceCurrentCropImage}
      />
    </>
  );
}
