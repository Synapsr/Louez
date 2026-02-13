'use client';

import { Info } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Label } from '@louez/ui';
import { Slider } from '@louez/ui';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@louez/ui';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@louez/ui';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@louez/ui';

import { getFieldError } from '@/hooks/form/form-context';

import type {
  DurationUnit,
  StoreSettingsUnitsState,
} from '../hooks/use-store-settings-units';

interface StoreSettingsRentalRulesSectionProps {
  form: any;
  stripeChargesEnabled: boolean;
  reservationMode: 'payment' | 'request';
  onStripeRequired: () => void;
  units: StoreSettingsUnitsState;
}

export function StoreSettingsRentalRulesSection({
  form,
  stripeChargesEnabled,
  reservationMode,
  onStripeRequired,
  units,
}: StoreSettingsRentalRulesSectionProps) {
  const t = useTranslations('dashboard.settings');
  const tCommon = useTranslations('common');

  const handleMinutesInputChange = (
    rawValue: string,
    currentUnit: DurationUnit,
    onChange: (value: number) => void,
  ) => {
    if (rawValue === '') {
      onChange(0);
      return;
    }

    const parsed = parseInt(rawValue);
    if (!isNaN(parsed)) {
      onChange(units.fromDisplayValue(parsed, currentUnit));
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('reservationSettings.title')}</CardTitle>
        <CardDescription>{t('reservationSettings.description')}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <form.Field name="reservationMode">
            {(field: any) => (
              <div className="grid gap-2">
                <Label htmlFor={field.name}>{t('reservationSettings.mode')}</Label>
                <Select
                  onValueChange={(value) => {
                    if (value === null) return;
                    if (value === 'payment' && !stripeChargesEnabled) {
                      onStripeRequired();
                      return;
                    }
                    field.handleChange(value);
                  }}
                  value={field.state.value}
                >
                  <SelectTrigger>
                    <SelectValue>
                      {field.state.value === 'payment'
                        ? t('reservationSettings.modePayment')
                        : t('reservationSettings.modeRequest')}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem
                      value="payment"
                      label={t('reservationSettings.modePayment')}
                    >
                      {t('reservationSettings.modePayment')}
                    </SelectItem>
                    <SelectItem
                      value="request"
                      label={t('reservationSettings.modeRequest')}
                    >
                      {t('reservationSettings.modeRequest')}
                    </SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-muted-foreground text-sm">
                  {field.state.value === 'payment'
                    ? t('reservationSettings.modePaymentDescription')
                    : t('reservationSettings.modeRequestDescription')}
                </p>
                {field.state.meta.errors.length > 0 && (
                  <p className="text-destructive text-sm">
                    {getFieldError(field.state.meta.errors[0])}
                  </p>
                )}
              </div>
            )}
          </form.Field>
        </div>

        {reservationMode === 'request' && (
          <form.AppField name="pendingBlocksAvailability">
            {(field: any) => (
              <field.Switch
                label={t('reservationSettings.pendingBlocksAvailability')}
                description={t(
                  'reservationSettings.pendingBlocksAvailabilityDescription',
                )}
              />
            )}
          </form.AppField>
        )}

        {reservationMode === 'payment' && (
          <form.Field name="onlinePaymentDepositPercentage">
            {(field: any) => (
              <div className="rounded-lg border p-4">
                <div className="flex flex-row items-center justify-between">
                  <div className="space-y-0.5">
                    <Label htmlFor={field.name} className="text-base">
                      {t('reservationSettings.depositPercentage')}
                    </Label>
                    <p className="text-muted-foreground text-sm">
                      {field.state.value === 100
                        ? t('reservationSettings.depositPercentageFull')
                        : t('reservationSettings.depositPercentagePartial', {
                            percentage: field.state.value,
                          })}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <Slider
                      value={field.state.value}
                      onValueChange={(value) =>
                        field.handleChange(Array.isArray(value) ? value[0] : value)
                      }
                      min={10}
                      max={100}
                      step={5}
                      className="w-28"
                    />
                    <span className="w-12 text-right text-sm font-medium tabular-nums">
                      {field.state.value}%
                    </span>
                  </div>
                </div>
              </div>
            )}
          </form.Field>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <form.Field name="minRentalMinutes">
            {(field: any) => {
              const displayValue = units.getDisplayValue(
                field.state.value,
                units.minDurationUnit,
              );

              return (
                <div className="grid gap-2">
                  <div className="flex items-center gap-1.5">
                    <Label htmlFor={field.name}>
                      {t('reservationSettings.minRentalHours')}
                    </Label>
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <Info className="text-muted-foreground h-3.5 w-3.5 cursor-help" />
                          }
                        />
                        <TooltipContent side="top" className="max-w-xs">
                          <p>{t('reservationSettings.minRentalHoursHelp')}</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                  <div className="border-input dark:bg-input/30 has-[:focus]:border-ring has-[:focus]:ring-ring/50 flex h-9 rounded-md border bg-transparent shadow-xs has-[:focus]:ring-[3px]">
                    <input
                      type="number"
                      min={0}
                      step={1}
                      className="min-w-0 flex-1 [appearance:textfield] rounded-l-md bg-transparent px-3 text-base outline-none md:text-sm [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                      value={displayValue || ''}
                      onChange={(event) =>
                        handleMinutesInputChange(
                          event.target.value,
                          units.minDurationUnit,
                          field.handleChange,
                        )
                      }
                    />
                    <select
                      className="border-input bg-muted/50 text-muted-foreground h-full cursor-pointer rounded-r-md border-l px-2.5 text-sm outline-none"
                      value={units.minDurationUnit}
                      onChange={(event) => {
                        const nextUnit = event.target.value as DurationUnit;
                        field.handleChange(
                          units.normalizeForUnitSwitch(field.state.value, nextUnit),
                        );
                        units.setMinDurationUnit(nextUnit);
                      }}
                    >
                      <option value="hours">{tCommon('hourUnit', { count: 2 })}</option>
                      <option value="days">{tCommon('dayUnit', { count: 2 })}</option>
                    </select>
                  </div>
                  {field.state.meta.errors.length > 0 && (
                    <p className="text-destructive text-sm">
                      {getFieldError(field.state.meta.errors[0])}
                    </p>
                  )}
                </div>
              );
            }}
          </form.Field>

          <form.Field name="advanceNoticeMinutes">
            {(field: any) => {
              const displayValue = units.getDisplayValue(
                field.state.value,
                units.advanceNoticeUnit,
              );

              return (
                <div className="grid gap-2">
                  <div className="flex items-center gap-1.5">
                    <Label htmlFor={field.name}>{t('reservationSettings.leadTime')}</Label>
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger
                          render={
                            <Info className="text-muted-foreground h-3.5 w-3.5 cursor-help" />
                          }
                        />
                        <TooltipContent side="top" className="max-w-xs">
                          <p>{t('reservationSettings.leadTimeHelp')}</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                  <div className="border-input dark:bg-input/30 has-[:focus]:border-ring has-[:focus]:ring-ring/50 flex h-9 rounded-md border bg-transparent shadow-xs has-[:focus]:ring-[3px]">
                    <input
                      type="number"
                      min={0}
                      step={1}
                      className="min-w-0 flex-1 [appearance:textfield] rounded-l-md bg-transparent px-3 text-base outline-none md:text-sm [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                      value={displayValue || ''}
                      onChange={(event) =>
                        handleMinutesInputChange(
                          event.target.value,
                          units.advanceNoticeUnit,
                          field.handleChange,
                        )
                      }
                    />
                    <select
                      className="border-input bg-muted/50 text-muted-foreground h-full cursor-pointer rounded-r-md border-l px-2.5 text-sm outline-none"
                      value={units.advanceNoticeUnit}
                      onChange={(event) => {
                        const nextUnit = event.target.value as DurationUnit;
                        field.handleChange(
                          units.normalizeForUnitSwitch(field.state.value, nextUnit),
                        );
                        units.setAdvanceNoticeUnit(nextUnit);
                      }}
                    >
                      <option value="hours">{tCommon('hourUnit', { count: 2 })}</option>
                      <option value="days">{tCommon('dayUnit', { count: 2 })}</option>
                    </select>
                  </div>
                  {field.state.meta.errors.length > 0 && (
                    <p className="text-destructive text-sm">
                      {getFieldError(field.state.meta.errors[0])}
                    </p>
                  )}
                </div>
              );
            }}
          </form.Field>
        </div>

        <form.AppField name="requireCustomerAddress">
          {(field: any) => (
            <field.Switch
              label={t('reservationSettings.requireAddress')}
              description={t('reservationSettings.requireAddressDescription')}
            />
          )}
        </form.AppField>
      </CardContent>
    </Card>
  );
}
