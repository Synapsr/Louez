'use client';

import { type FormEvent, useEffect, useState } from 'react';

import { useTranslations } from 'next-intl';

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@louez/ui';
import { Label } from '@louez/ui';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@louez/ui';
import { Switch } from '@louez/ui';

interface TulipConfigurationSectionProps {
  disabled: boolean;
  settings: {
    publicMode: 'required' | 'optional' | 'no_public';
    includeInFinalPrice: boolean;
    renterUid: string | null;
    contractType: 'LCD' | 'LMD' | 'LLD';
  };
  isPending: boolean;
  onSave: (input: {
    publicMode: 'required' | 'optional' | 'no_public';
    includeInFinalPrice: boolean;
    contractType: 'LCD' | 'LMD' | 'LLD';
  }) => Promise<void>;
}

export function TulipConfigurationSection({
  disabled,
  settings,
  isPending,
  onSave,
}: TulipConfigurationSectionProps) {
  const t = useTranslations(
    'dashboard.settings.integrationsPage.assurance.configuration',
  );

  const [publicMode, setPublicMode] = useState(settings.publicMode);
  const [includeInFinalPrice, setIncludeInFinalPrice] = useState(
    settings.includeInFinalPrice,
  );
  const [contractType, setContractType] = useState(settings.contractType);

  useEffect(() => {
    setPublicMode(settings.publicMode);
    setIncludeInFinalPrice(settings.includeInFinalPrice);
    setContractType(settings.contractType);
  }, [settings]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    await onSave({
      publicMode,
      includeInFinalPrice,
      contractType,
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('title')}</CardTitle>
        <CardDescription>{t('description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {disabled && (
          <p className="text-muted-foreground rounded-md border border-dashed p-3 text-sm">
            {t('disabledMessage')}
          </p>
        )}

        <form className="space-y-6" onSubmit={handleSubmit}>
          <div className="grid gap-2">
            <Label htmlFor="assurance-mode">{t('modeLabel')}</Label>
            <Select
              value={publicMode}
              onValueChange={(value) => {
                if (
                  value === 'required' ||
                  value === 'optional' ||
                  value === 'no_public'
                ) {
                  setPublicMode(value);
                }
              }}
              disabled={disabled || isPending}
            >
              <SelectTrigger id="assurance-mode">
                <SelectValue>
                  {publicMode === 'required'
                    ? t('modeRequired')
                    : publicMode === 'optional'
                      ? t('modeOptional')
                      : t('modeNoPublic')}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="required">{t('modeRequired')}</SelectItem>
                <SelectItem value="optional">{t('modeOptional')}</SelectItem>
                <SelectItem value="no_public">{t('modeNoPublic')}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between rounded-lg border p-4">
            <div className="space-y-0.5">
              <p className="text-sm font-medium">{t('includePriceLabel')}</p>
              <p className="text-muted-foreground text-sm">
                {t('includePriceHelp')}
              </p>
            </div>
            <Switch
              checked={includeInFinalPrice}
              onCheckedChange={setIncludeInFinalPrice}
              disabled={disabled || isPending}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="assurance-contract-type">
              {t('contractTypeLabel')}
            </Label>
            <Select
              value={contractType}
              onValueChange={(value) => {
                if (value === 'LCD' || value === 'LMD' || value === 'LLD') {
                  setContractType(value);
                }
              }}
              disabled={disabled || isPending}
            >
              <SelectTrigger id="assurance-contract-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="LCD">LCD</SelectItem>
                <SelectItem value="LMD">LMD</SelectItem>
                <SelectItem value="LLD">LLD</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-muted-foreground text-sm">
              {t('contractTypeHelp')}
            </p>
          </div>

          <div className="flex justify-end">
            <Button type="submit" disabled={disabled || isPending}>
              {isPending ? t('savingButton') : t('saveButton')}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
