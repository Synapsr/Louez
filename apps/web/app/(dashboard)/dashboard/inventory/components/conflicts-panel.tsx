'use client';

import { useMemo, useState } from 'react';

import Link from 'next/link';
import { useRouter } from 'next/navigation';

import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Loader2,
} from 'lucide-react';
import { useTranslations } from 'next-intl';

import {
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  toastManager,
} from '@louez/ui';

import { formatDateRange } from '@/lib/utils';

import { reassignReservationItemUnit } from '../actions';
import type { InventoryConflict } from './inventory-types';
import { getTranslatedActionError } from './util.inventory-format';

interface ConflictsPanelProps {
  conflicts: InventoryConflict[];
  fromUnitId: string;
}

type ResolutionState = 'left' | 'reassigned';

export const ConflictsPanel = ({
  conflicts,
  fromUnitId,
}: ConflictsPanelProps) => {
  const t = useTranslations('dashboard.inventory.conflicts');
  const tErrors = useTranslations('errors');
  const router = useRouter();
  const [selectedCandidates, setSelectedCandidates] = useState<
    Record<string, string>
  >({});
  const [resolutionByItemId, setResolutionByItemId] = useState<
    Record<string, ResolutionState>
  >({});
  const [pendingItemId, setPendingItemId] = useState<string | null>(null);

  const unresolvedCount = useMemo(
    () =>
      conflicts.filter(
        (conflict) => !resolutionByItemId[conflict.reservationItemId],
      ).length,
    [conflicts, resolutionByItemId],
  );

  const handleReassign = async (conflict: InventoryConflict) => {
    const toUnitId =
      selectedCandidates[conflict.reservationItemId] ??
      conflict.replacementCandidates[0]?.id;

    if (!toUnitId) {
      return;
    }

    setPendingItemId(conflict.reservationItemId);
    try {
      const result = await reassignReservationItemUnit({
        reservationItemId: conflict.reservationItemId,
        fromUnitId,
        toUnitId,
      });

      if ('error' in result && result.error) {
        toastManager.add({
          title: getTranslatedActionError(result.error, tErrors),
          type: 'error',
        });
        return;
      }

      setResolutionByItemId((current) => ({
        ...current,
        [conflict.reservationItemId]: 'reassigned',
      }));
      toastManager.add({ title: t('reassignedToast'), type: 'success' });
      router.refresh();
    } catch {
      toastManager.add({ title: tErrors('generic'), type: 'error' });
    } finally {
      setPendingItemId(null);
    }
  };

  const handleLeaveAsIs = (conflict: InventoryConflict) => {
    setResolutionByItemId((current) => ({
      ...current,
      [conflict.reservationItemId]: 'left',
    }));
  };

  if (conflicts.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
      <div className="flex gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
        <div className="space-y-1">
          <h4 className="text-sm font-medium">{t('title')}</h4>
          <p className="text-muted-foreground text-sm">
            {t('description', { count: unresolvedCount })}
          </p>
        </div>
      </div>

      <div className="space-y-3">
        {conflicts.map((conflict) => {
          const resolution = resolutionByItemId[conflict.reservationItemId];
          const selectedCandidateId =
            selectedCandidates[conflict.reservationItemId] ??
            conflict.replacementCandidates[0]?.id ??
            '';
          const isPending = pendingItemId === conflict.reservationItemId;

          return (
            <div
              key={conflict.reservationItemId}
              className="bg-background rounded-md border p-3"
            >
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/dashboard/reservations/${conflict.reservationId}`}
                      className="font-medium hover:underline"
                    >
                      {t('reservation', {
                        number: conflict.reservationNumber,
                      })}
                    </Link>
                    <ExternalLink className="text-muted-foreground h-3.5 w-3.5" />
                  </div>
                  <p className="text-muted-foreground text-sm">
                    {formatDateRange(conflict.startDate, conflict.endDate)}
                  </p>
                  <p className="text-muted-foreground text-sm">
                    {conflict.customerName ?? t('unknownCustomer')}
                  </p>
                </div>

                {resolution ? (
                  <div className="text-muted-foreground flex items-center gap-1 text-sm">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                    {resolution === 'reassigned'
                      ? t('reassigned')
                      : t('leftAsIs')}
                  </div>
                ) : null}
              </div>

              {!resolution ? (
                <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                  <Select
                    value={selectedCandidateId}
                    onValueChange={(value) => {
                      if (value === null) return;
                      setSelectedCandidates((current) => ({
                        ...current,
                        [conflict.reservationItemId]: value,
                      }));
                    }}
                  >
                    <SelectTrigger
                      className="sm:w-[220px]"
                      disabled={conflict.replacementCandidates.length === 0}
                    >
                      <SelectValue placeholder={t('replacementUnit')}>
                        {conflict.replacementCandidates.find(
                          (candidate) => candidate.id === selectedCandidateId,
                        )?.identifier ?? t('noCandidates')}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {conflict.replacementCandidates.map((candidate) => (
                        <SelectItem
                          key={candidate.id}
                          value={candidate.id}
                          label={candidate.identifier}
                        >
                          {candidate.identifier}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    type="button"
                    onClick={() => handleReassign(conflict)}
                    disabled={
                      isPending || conflict.replacementCandidates.length === 0
                    }
                  >
                    {isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : null}
                    {t('reassign')}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => handleLeaveAsIs(conflict)}
                    disabled={isPending}
                  >
                    {t('leaveAsIs')}
                  </Button>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
};
