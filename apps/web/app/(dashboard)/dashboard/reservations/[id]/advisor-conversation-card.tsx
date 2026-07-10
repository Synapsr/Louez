'use client';

import { useQuery } from '@tanstack/react-query';
import { Bot, MessageSquare } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';

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
import { cn } from '@louez/utils';

import { orpc } from '@/lib/orpc/react';

const SUMMARY_KEY = 'summary';

// Collected facts keys are free-form snake/kebab-case strings produced by the
// advisor in the customer's language — prettify them for display.
function formatCollectedKey(key: string): string {
  const spaced = key.replace(/[_-]+/g, ' ').trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

interface AdvisorConversationCardProps {
  reservationId: string;
}

export const AdvisorConversationCard = ({
  reservationId,
}: AdvisorConversationCardProps) => {
  const t = useTranslations('dashboard.reservations.advisor');
  const format = useFormatter();

  const { data: conversation } = useQuery(
    orpc.dashboard.aiAdvisor.getByReservation.queryOptions({
      input: { reservationId },
    }),
  );

  if (!conversation) return null;

  const collectedData = conversation.collectedData ?? {};
  const summary = collectedData[SUMMARY_KEY];
  const detailEntries = Object.entries(collectedData).filter(
    ([key]) => key !== SUMMARY_KEY,
  );

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
        {(summary || detailEntries.length > 0) && (
          <div className="space-y-2">
            {summary && (
              <p className="text-sm italic text-muted-foreground">{summary}</p>
            )}
            {detailEntries.length > 0 && (
              <dl className="space-y-1 text-sm">
                {detailEntries.map(([key, value]) => (
                  <div key={key} className="flex justify-between gap-3">
                    <dt className="text-muted-foreground shrink-0">
                      {formatCollectedKey(key)}
                    </dt>
                    <dd className="min-w-0 break-words text-right font-medium">
                      {value}
                    </dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
        )}

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
              <div className="space-y-4">
                {conversation.messages.map((message) => (
                  <div
                    key={message.id}
                    className={cn(
                      'flex flex-col gap-1',
                      message.role === 'user' ? 'items-end' : 'items-start',
                    )}
                  >
                    <div
                      className={cn(
                        'max-w-[85%] whitespace-pre-wrap break-words rounded-lg px-3 py-2 text-sm',
                        message.role === 'user'
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted text-foreground',
                      )}
                    >
                      {message.content}
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {format.dateTime(new Date(message.createdAt), {
                        dateStyle: 'short',
                        timeStyle: 'short',
                      })}
                    </span>
                  </div>
                ))}
              </div>
            </SheetPanel>
          </SheetPopup>
        </Sheet>
      </CardContent>
    </Card>
  );
};
