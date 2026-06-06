'use client';

import { useRouter, useSearchParams } from 'next/navigation';

import { useTranslations } from 'next-intl';

import { Label, Switch } from '@louez/ui';

interface SalesScopeToggleProps {
  includeManualPayments: boolean;
}

const SALES_SCOPE_TOGGLE_ID = 'include-manual-payments';

export const SalesScopeToggle = ({
  includeManualPayments,
}: SalesScopeToggleProps) => {
  const router = useRouter();
  const searchParams = useSearchParams();
  const t = useTranslations('dashboard.statistics');

  const handleCheckedChange = (checked: boolean) => {
    const params = new URLSearchParams(searchParams.toString());

    if (checked) {
      params.set('includeManual', 'true');
    } else {
      params.delete('includeManual');
    }

    params.set('tab', 'sales');
    router.push(`/dashboard/analytics?${params.toString()}`);
  };

  return (
    <div className="bg-background/80 flex items-center justify-between gap-4 rounded-md border px-3 py-2 sm:min-w-[280px]">
      <div className="space-y-0.5">
        <Label
          htmlFor={SALES_SCOPE_TOGGLE_ID}
          className="text-sm leading-none font-medium"
        >
          {t('includeManualPayments')}
        </Label>
        <p className="text-muted-foreground text-xs">
          {t('includeManualPaymentsDescription')}
        </p>
      </div>
      <Switch
        id={SALES_SCOPE_TOGGLE_ID}
        checked={includeManualPayments}
        onCheckedChange={handleCheckedChange}
      />
    </div>
  );
};
