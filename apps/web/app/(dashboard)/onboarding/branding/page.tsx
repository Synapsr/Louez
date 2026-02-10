'use client';

import { useCallback, useState } from 'react';

import { useRouter } from 'next/navigation';

import { useMutation } from '@tanstack/react-query';
import { Loader2, Palette, Upload, X } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { toastManager } from '@louez/ui';
import { Button } from '@louez/ui';
import { Input } from '@louez/ui';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@louez/ui';
import { Label } from '@louez/ui';
import { Radio, RadioGroup } from '@louez/ui';
import { type BrandingInput, createBrandingSchema } from '@louez/validations';

import { orpc } from '@/lib/orpc/react';

import { useAppForm } from '@/hooks/form/form';

const PRESET_COLORS = [
  '#0066FF',
  '#10B981',
  '#F59E0B',
  '#EF4444',
  '#8B5CF6',
  '#EC4899',
  '#06B6D4',
  '#84CC16',
];

async function readFileAsDataUri(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => resolve(event.target?.result as string);
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

function resolveErrorMessage(
  tErrors: (key: string) => string,
  error: unknown,
): string {
  if (error instanceof Error) {
    if (error.message.startsWith('errors.')) {
      return tErrors(error.message.replace('errors.', ''));
    }
    if (error.message.trim().length > 0) {
      return error.message;
    }
  }

  return tErrors('generic');
}

function getFieldErrorText(error: unknown): string {
  if (typeof error === 'string') {
    return error;
  }
  if (
    typeof error === 'object' &&
    error !== null &&
    'message' in error &&
    typeof (error as { message?: unknown }).message === 'string'
  ) {
    return (error as { message: string }).message;
  }

  return String(error);
}

export default function OnboardingBrandingPage() {
  const router = useRouter();
  const t = useTranslations('onboarding.branding');
  const tCommon = useTranslations('common');
  const tErrors = useTranslations('errors');
  const tValidation = useTranslations('validation');
  const [logoPreview, setLogoPreview] = useState<string | null>(null);

  const brandingSchema = createBrandingSchema(tValidation);

  const uploadImageMutation = useMutation(
    orpc.dashboard.onboarding.uploadImage.mutationOptions(),
  );
  const updateBrandingMutation = useMutation(
    orpc.dashboard.onboarding.updateBranding.mutationOptions(),
  );

  const form = useAppForm({
    defaultValues: {
      logoUrl: '',
      primaryColor: '#0066FF',
      theme: 'light' as 'light' | 'dark',
    } as BrandingInput,
    validators: { onSubmit: brandingSchema },
    onSubmit: async ({ value }) => {
      try {
        await updateBrandingMutation.mutateAsync(value);
        router.push('/onboarding/stripe');
      } catch (error) {
        toastManager.add({
          title: resolveErrorMessage(tErrors, error),
          type: 'error',
        });
      }
    },
  });

  const handleLogoUpload = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = '';

      if (!file) return;

      if (!file.type.startsWith('image/')) {
        toastManager.add({ title: t('logoError'), type: 'error' });
        return;
      }

      if (file.size > 2 * 1024 * 1024) {
        toastManager.add({ title: t('logoSizeError'), type: 'error' });
        return;
      }

      const previousLogoPreview = logoPreview;

      try {
        const dataUri = await readFileAsDataUri(file);
        setLogoPreview(dataUri);

        const uploaded = await uploadImageMutation.mutateAsync({
          image: dataUri,
          type: 'logo',
          filename: 'store-logo',
        });

        form.setFieldValue('logoUrl', uploaded.url);
        setLogoPreview(uploaded.url);
      } catch (error) {
        toastManager.add({
          title: resolveErrorMessage(tErrors, error),
          type: 'error',
        });
        setLogoPreview(previousLogoPreview);
        form.setFieldValue('logoUrl', '');
      }
    },
    [form, logoPreview, t, tErrors, uploadImageMutation],
  );

  const removeLogo = useCallback(() => {
    setLogoPreview(null);
    form.setFieldValue('logoUrl', '');
  }, [form]);

  const isBusy =
    updateBrandingMutation.isPending || uploadImageMutation.isPending;

  return (
    <Card>
      <CardHeader className="text-center">
        <div className="bg-primary/10 mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full">
          <Palette className="text-primary h-6 w-6" />
        </div>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent>
        <form.AppForm>
          <form.Form className="space-y-6">
            <form.Field name="logoUrl">
              {() => (
                <div className="space-y-2">
                  <Label>{t('logo')}</Label>
                  <div className="flex flex-col items-center gap-4">
                    {logoPreview ? (
                      <div className="relative">
                        <img
                          src={logoPreview}
                          alt="Logo preview"
                          className="h-24 w-24 rounded-lg border object-contain"
                        />
                        {uploadImageMutation.isPending && (
                          <div className="bg-background/80 absolute inset-0 flex items-center justify-center rounded-lg">
                            <Loader2 className="text-primary h-6 w-6 animate-spin" />
                          </div>
                        )}
                        {!uploadImageMutation.isPending && (
                          <Button
                            type="button"
                            variant="destructive"
                            size="icon"
                            className="absolute -top-2 -right-2 h-6 w-6"
                            onClick={removeLogo}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    ) : (
                      <label className="border-muted-foreground/25 hover:border-muted-foreground/50 flex h-24 w-24 cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed transition-colors">
                        <Upload className="text-muted-foreground h-8 w-8" />
                        <span className="text-muted-foreground mt-1 text-xs">
                          {t('logoAdd')}
                        </span>
                        <input
                          type="file"
                          accept="image/*"
                          className="sr-only"
                          onChange={handleLogoUpload}
                        />
                      </label>
                    )}
                  </div>
                  <p className="text-muted-foreground text-center text-sm">
                    {t('logoHelp')}
                  </p>
                </div>
              )}
            </form.Field>

            <form.Field name="primaryColor">
              {(field) => (
                <div className="space-y-2">
                  <Label>{t('primaryColor')}</Label>
                  <div className="space-y-3">
                    <div className="flex flex-wrap gap-2">
                      {PRESET_COLORS.map((color) => (
                        <button
                          key={color}
                          type="button"
                          className={`h-8 w-8 rounded-full transition-all ${
                            field.state.value === color
                              ? 'ring-primary ring-2 ring-offset-2'
                              : 'hover:scale-110'
                          }`}
                          style={{ backgroundColor: color }}
                          onClick={() =>
                            form.setFieldValue('primaryColor', color)
                          }
                        />
                      ))}
                    </div>
                    <div className="flex items-center gap-2">
                      <div
                        className="h-9 w-9 rounded-md border"
                        style={{ backgroundColor: field.state.value }}
                      />
                      <Input
                        value={field.state.value}
                        onChange={(event) =>
                          field.handleChange(event.target.value)
                        }
                        onBlur={field.handleBlur}
                        placeholder="#0066FF"
                        className="font-mono"
                      />
                    </div>
                  </div>
                  {field.state.meta.errors.length > 0 && (
                    <p className="text-destructive text-sm font-medium">
                      {getFieldErrorText(field.state.meta.errors[0])}
                    </p>
                  )}
                </div>
              )}
            </form.Field>

            <form.Field name="theme">
              {(field) => (
                <div className="space-y-2">
                  <Label>{t('theme')}</Label>
                  <RadioGroup
                    value={field.state.value}
                    onValueChange={(value) =>
                      field.handleChange(value as 'light' | 'dark')
                    }
                    className="grid grid-cols-2 gap-4"
                  >
                    <Label className="hover:bg-accent/50 has-data-checked:border-primary/48 has-data-checked:bg-accent/50 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 p-4">
                      <Radio value="light" className="hidden" />
                      <div className="h-8 w-12 rounded border bg-white" />
                      <span className="text-sm font-medium">
                        {t('themeLight')}
                      </span>
                    </Label>
                    <Label className="hover:bg-accent/50 has-data-checked:border-primary/48 has-data-checked:bg-accent/50 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 p-4">
                      <Radio value="dark" className="hidden" />
                      <div className="h-8 w-12 rounded border bg-zinc-900" />
                      <span className="text-sm font-medium">
                        {t('themeDark')}
                      </span>
                    </Label>
                  </RadioGroup>
                  {field.state.meta.errors.length > 0 && (
                    <p className="text-destructive text-sm font-medium">
                      {getFieldErrorText(field.state.meta.errors[0])}
                    </p>
                  )}
                </div>
              )}
            </form.Field>

            <div className="flex gap-3">
              <Button
                type="button"
                variant="outline"
                className="flex-1"
                onClick={() => router.push('/onboarding')}
                disabled={isBusy}
              >
                {tCommon('back')}
              </Button>
              <Button type="submit" className="flex-1" disabled={isBusy}>
                {isBusy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {tCommon('next')}
              </Button>
            </div>
          </form.Form>
        </form.AppForm>
      </CardContent>
    </Card>
  );
}
