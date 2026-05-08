'use client';

import Link from 'next/link';

import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button } from '@louez/ui';

import { ChatBubble } from './ai-chat';
import { DashboardNotificationsButton } from './dashboard-notifications-button';

export const DashboardHeaderActions = ({
  showAIChat,
}: {
  showAIChat: boolean;
}) => {
  const t = useTranslations('dashboard.sidebar');

  return (
    <div className="ml-auto flex shrink-0 items-center gap-2">
      {showAIChat && <ChatBubble />}
      <DashboardNotificationsButton />
      <Button
        render={<Link href="/dashboard/reservations/new" />}
        variant="outline"
      >
        <Plus className="h-4 w-4" />
        <span className="max-md:hidden">{t('newReservation')}</span>
      </Button>
    </div>
  );
};
