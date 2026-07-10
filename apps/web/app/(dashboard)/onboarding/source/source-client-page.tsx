'use client';

import { useTranslations } from 'next-intl';

import { Button } from '@louez/ui';
import { Input } from '@louez/ui';
import { Label } from '@louez/ui';
import { Radio, RadioGroup } from '@louez/ui';

import {
  ACQUISITION_CHANNELS,
  type AcquisitionChannel,
} from '@louez/validations';

import { OnboardingStepHeader } from '../_components/step-header';
import { useSourceStep } from './use-source-step';

const CHANNEL_LABEL_KEY: Record<AcquisitionChannel, string> = {
  word_of_mouth: 'wordOfMouth',
  search_engine: 'searchEngine',
  instagram_tiktok: 'instagramTiktok',
  facebook: 'facebook',
  youtube: 'youtube',
  ai_assistant: 'aiAssistant',
  ads: 'ads',
  other: 'other',
};

export function SourceClientPage() {
  const t = useTranslations('onboarding.source');
  const { form, channel, handleSkip, isPending } = useSourceStep();

  return (
    <>
      <OnboardingStepHeader title={t('title')} description={t('description')} />
      <form.AppForm>
        <form.Form className="space-y-6">
          <form.Field name="channel">
            {(field) => (
              <RadioGroup
                value={field.state.value}
                onValueChange={(value) => {
                  if (value !== null) {
                    field.handleChange(value as AcquisitionChannel);
                  }
                }}
                className="space-y-1"
              >
                {ACQUISITION_CHANNELS.map((option) => (
                  <Label
                    key={option}
                    className="hover:bg-accent/30 has-data-checked:bg-accent/50 flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-normal transition-colors"
                  >
                    <Radio value={option} />
                    {t(CHANNEL_LABEL_KEY[option])}
                  </Label>
                ))}
              </RadioGroup>
            )}
          </form.Field>

          {channel === 'other' && (
            <form.Field name="other">
              {(field) => (
                <Input
                  value={field.state.value}
                  onChange={(event) => field.handleChange(event.target.value)}
                  onBlur={field.handleBlur}
                  placeholder={t('otherPlaceholder')}
                  autoFocus
                />
              )}
            </form.Field>
          )}

          <div className="flex items-center gap-3 pt-2">
            <Button
              type="button"
              variant="ghost"
              className="text-muted-foreground"
              onClick={handleSkip}
              disabled={isPending}
            >
              {t('skip')}
            </Button>
            <form.SubscribeButton className="flex-1" disabled={!channel}>
              {t('finish')}
            </form.SubscribeButton>
          </div>
        </form.Form>
      </form.AppForm>
    </>
  );
}
