'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bot, MessageSquare, Phone } from 'lucide-react';
import { useTranslations } from 'next-intl';

import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@louez/ui';

import { AdvisorConversationSheet } from '@/components/dashboard/advisor-conversation-sheet';
import { AdvisorCollectedData } from '@/components/dashboard/advisor-transcript';
import { orpc } from '@/lib/orpc/react';

interface AdvisorConversationCardProps {
  reservationId: string;
}

export const AdvisorConversationCard = ({
  reservationId,
}: AdvisorConversationCardProps) => {
  const t = useTranslations('dashboard.reservations.advisor');
  const [sheetOpen, setSheetOpen] = useState(false);

  const { data: conversation } = useQuery(
    orpc.dashboard.aiAdvisor.getByReservation.queryOptions({
      input: { reservationId },
    }),
  );

  if (!conversation) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          {conversation.channel === 'phone' ? (
            <Phone className="h-4 w-4" />
          ) : (
            <Bot className="h-4 w-4" />
          )}
          {t('cardTitle')}
          {conversation.validatedAt && (
            <Badge
              variant="secondary"
              className="ml-auto bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300"
            >
              {t('validated')}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <AdvisorCollectedData collectedData={conversation.collectedData} />

        {/* The full detail (transcript + call recording) opens in the same
            sheet as the AI assistant's conversations list. */}
        <Button
          variant="outline"
          className="w-full"
          onClick={() => setSheetOpen(true)}
        >
          <MessageSquare className="mr-1.5 h-3.5 w-3.5" />
          {t('viewConversation')}
        </Button>
        <AdvisorConversationSheet
          conversationId={sheetOpen ? conversation.id : null}
          onOpenChange={setSheetOpen}
        />
      </CardContent>
    </Card>
  );
};
