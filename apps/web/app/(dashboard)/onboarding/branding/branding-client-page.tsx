'use client';

import { useRouter } from 'next/navigation';

import { useTranslations } from 'next-intl';

import { Button } from '@louez/ui';
import { Input } from '@louez/ui';
import { Label } from '@louez/ui';
import { Radio, RadioGroup } from '@louez/ui';

import { getFieldError } from '@/hooks/form/form-context';

import { OnboardingStepHeader } from '../_components/step-header';
import { useBrandingStep } from './use-branding-step';

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

export function BrandingClientPage() {
  const router = useRouter();
  const t = useTranslations('onboarding.branding');
  const tCommon = useTranslations('common');
  const tErrors = useTranslations('errors');
  const { form, handleLogoSelected, isUploading, isBusy } = useBrandingStep();

  return (
    <>
      <OnboardingStepHeader title={t('title')} description={t('description')} />
      <form.AppForm>
        <form.Form className="space-y-6">
          <form.AppField name="logoUrl">
            {(field) => (
              <field.ImageUpload
                label={t('logo')}
                description={t('logoHelp')}
                uploadLabel={tCommon('upload')}
                removeLabel={tCommon('remove')}
                shape="square"
                isUploading={isUploading}
                messages={{
                  invalidType: t('logoError'),
                  tooLarge: t('logoSizeError'),
                  readFailed: tErrors('generic'),
                }}
                onFileSelected={handleLogoSelected}
                onRemove={() => field.handleChange('')}
              />
            )}
          </form.AppField>

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
                        aria-label={color}
                        className={`size-7 rounded-full transition-all ${
                          field.state.value === color
                            ? 'ring-foreground ring-offset-background ring-2 ring-offset-2'
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
                      className="size-9 shrink-0 rounded-md border"
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
                    {getFieldError(field.state.meta.errors[0])}
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
                  className="grid grid-cols-2 gap-3"
                >
                  <Label className="hover:bg-accent/30 has-data-checked:border-foreground/30 has-data-checked:bg-accent/50 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border p-4 transition-colors">
                    <Radio value="light" className="hidden" />
                    <div className="h-8 w-12 rounded-md border border-zinc-200 bg-white" />
                    <span className="text-sm font-medium">
                      {t('themeLight')}
                    </span>
                  </Label>
                  <Label className="hover:bg-accent/30 has-data-checked:border-foreground/30 has-data-checked:bg-accent/50 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border p-4 transition-colors">
                    <Radio value="dark" className="hidden" />
                    <div className="h-8 w-12 rounded-md border border-zinc-700 bg-zinc-900" />
                    <span className="text-sm font-medium">
                      {t('themeDark')}
                    </span>
                  </Label>
                </RadioGroup>
                {field.state.meta.errors.length > 0 && (
                  <p className="text-destructive text-sm font-medium">
                    {getFieldError(field.state.meta.errors[0])}
                  </p>
                )}
              </div>
            )}
          </form.Field>

          <div className="flex items-center gap-3 pt-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => router.push('/onboarding')}
              disabled={isBusy}
            >
              {tCommon('back')}
            </Button>
            <form.SubscribeButton className="flex-1" disabled={isBusy}>
              {tCommon('next')}
            </form.SubscribeButton>
          </div>
        </form.Form>
      </form.AppForm>
    </>
  );
}
