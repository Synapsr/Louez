'use client';

import Link from 'next/link';

import { ArrowRight, Clock } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { cn } from '@louez/utils';

import { useReservationPolling } from '@/contexts/reservation-polling-context';

interface PendingReservationsAlertProps {
  className?: string;
  onNavigate?: () => void;
}

export function PendingReservationsAlert({
  className,
  onNavigate,
}: PendingReservationsAlertProps) {
  const { pendingCount } = useReservationPolling();
  const t = useTranslations('dashboard.pendingAlert');

  // Don't show if no pending reservations
  if (pendingCount === 0) return null;

  return (
    <Link
      href="/dashboard/reservations?status=pending"
      onClick={onNavigate}
      className={cn(
        'group flex items-center gap-3 rounded-xl p-2 transition-all duration-200',
        'border border-orange-500/20 bg-orange-50 hover:bg-orange-100',
        'animate-in fade-in slide-in-from-bottom-2 duration-300',
        className,
      )}
    >
      {/* Icon with pulse animation */}
      <div className="relative">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-orange-500 text-white">
          <Clock className="h-4 w-4" />
        </div>
        {/* Pulse indicator */}
        <span className="absolute -top-1 -right-1 flex h-4 w-4">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-orange-400 opacity-75" />
          <span className="relative inline-flex h-4 w-4 items-center justify-center rounded-full bg-orange-500 text-[10px] font-bold text-white">
            {pendingCount > 9 ? '9+' : pendingCount}
          </span>
        </span>
      </div>

      {/* Text */}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-orange-700 dark:text-orange-300">
          {pendingCount === 1
            ? t('singlePending')
            : t('multiplePending', { count: pendingCount })}
        </p>
        {/*  <p className="text-xs text-orange-600/80 dark:text-orange-400/80">
          {t('clickToView')}
        </p> */}
      </div>

      {/* Arrow */}
      <ArrowRight className="h-4 w-4 text-orange-500 transition-transform group-hover:translate-x-1" />
    </Link>
  );
}
