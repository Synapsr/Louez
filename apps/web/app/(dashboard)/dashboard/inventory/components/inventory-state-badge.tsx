'use client';

import { useTranslations } from 'next-intl';

import { Badge } from '@louez/ui';
import { cn } from '@louez/utils';

import type { InventoryOperationalState } from '../queries';

const STATE_STYLES = {
  available:
    'bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-400',
  reserved: 'bg-sky-500/10 text-sky-700 hover:bg-sky-500/20 dark:text-sky-400',
  rented_out: 'bg-primary/10 text-primary hover:bg-primary/20',
  overdue: 'bg-red-500/10 text-red-700 hover:bg-red-500/20 dark:text-red-400',
  in_downtime:
    'bg-amber-500/10 text-amber-700 hover:bg-amber-500/20 dark:text-amber-400',
  retired: 'bg-muted text-muted-foreground',
} satisfies Record<InventoryOperationalState, string>;

interface InventoryStateBadgeProps {
  state: InventoryOperationalState;
  className?: string;
}

export const InventoryStateBadge = ({
  state,
  className,
}: InventoryStateBadgeProps) => {
  const t = useTranslations('dashboard.inventory.states');

  return (
    <Badge className={cn(STATE_STYLES[state], className)}>{t(state)}</Badge>
  );
};
