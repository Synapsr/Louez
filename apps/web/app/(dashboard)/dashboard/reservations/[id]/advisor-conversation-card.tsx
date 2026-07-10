'use client';

import { useQuery } from '@tanstack/react-query';
import { Bot, MessageSquare } from 'lucide-react';
import { useTranslations } from 'next-intl';

import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Sheet,
  SheetDescription,
  SheetHeader,
  SheetPanel,
  SheetPopup,
  SheetTitle,
  SheetTrigger,
} from '@louez/ui';

import {
  AdvisorCollectedData,
  AdvisorTranscriptMessages,
} from '@/components/dashboard/advisor-transcript';
import { orpc } from '@/lib/orpc/react';

interface AdvisorConversationCardProps {
  reservationId: string;
}

export const AdvisorConversationCard = ({
  reservationId,
}: AdvisorConversationCardProps) => {
  const t = useTranslations('dashboard.reservations.advisor');

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
          <Bot className="h-4 w-4" />
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

        <Sheet>
          <SheetTrigger render={<Button variant="outline" className="w-full" />}>
            <MessageSquare className="mr-1.5 h-3.5 w-3.5" />
            {t('viewConversation')}
          </SheetTrigger>
          <SheetPopup side="right">
            <SheetHeader>
              <SheetTitle>{t('sheetTitle')}</SheetTitle>
              <SheetDescription>{t('sheetDescription')}</SheetDescription>
            </SheetHeader>
            <SheetPanel>
              <AdvisorTranscriptMessages messages={conversation.messages} />
            </SheetPanel>
          </SheetPopup>
        </Sheet>
      </CardContent>
    </Card>
  );
};
