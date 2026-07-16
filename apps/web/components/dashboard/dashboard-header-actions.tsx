'use client';

import { useState } from 'react';

import Link from 'next/link';

import { Lock, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button } from '@louez/ui';
import { useIsMobile } from '@louez/ui/hooks/use-mobile';

import { UpgradeModal } from '@/components/dashboard/upgrade-modal';

import type { LimitStatus } from '@/lib/plan-limits';

import { ChatBubble } from './ai-chat';
import { DashboardNotificationsButton } from './dashboard-notifications-button';

export const DashboardHeaderActions = ({
  showAIChat,
  reservationLimits,
  planSlug,
}: {
  showAIChat: boolean;
  reservationLimits: LimitStatus;
  planSlug: string;
}) => {
  const t = useTranslations('dashboard.sidebar');
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const isAtReservationLimit = reservationLimits.isAtLimit;

  const isMobile = useIsMobile();

  return (
    <>
      <div className="ml-auto flex shrink-0 items-center gap-2">
        {showAIChat && <ChatBubble />}
        <DashboardNotificationsButton />
        {isAtReservationLimit ? (
          <Button
            size={isMobile ? 'icon-lg' : 'default'}
            variant="outline"
            onClick={() => setShowUpgradeModal(true)}
          >
            <Lock className="h-4 w-4" />
            <span className="max-md:hidden">{t('newReservation')}</span>
          </Button>
        ) : (
          <Button
            size={isMobile ? 'icon-lg' : 'default'}
            render={
              <Link href="/dashboard/reservations/new?source=dashboard_header" />
            }
            variant="outline"
          >
            <Plus className="h-4 w-4" />
            <span className="max-md:hidden">{t('newReservation')}</span>
          </Button>
        )}
      </div>
      <UpgradeModal
        open={showUpgradeModal}
        onOpenChange={setShowUpgradeModal}
        limitType="reservations"
        currentCount={reservationLimits.current}
        limit={reservationLimits.limit || 10}
        currentPlan={planSlug}
      />
    </>
  );
};
