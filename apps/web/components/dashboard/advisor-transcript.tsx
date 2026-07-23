'use client';

import { useFormatter } from 'next-intl';

import { cn } from '@louez/utils';

import { VERIFICATION_KICKOFF_PROMPT } from '@/lib/ai/advisor/kickoff';

const SUMMARY_KEY = 'summary';

// Collected facts keys are free-form snake/kebab-case strings produced by the
// advisor in the customer's language — prettify them for display.
function formatCollectedKey(key: string): string {
  const spaced = key.replace(/[_-]+/g, ' ').trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

type AdvisorCollectedDataProps = {
  collectedData: Record<string, string> | null;
};

/** Summary sentence + prettified key/value list from an advisor conversation. */
export const AdvisorCollectedData = ({
  collectedData,
}: AdvisorCollectedDataProps) => {
  const data = collectedData ?? {};
  const summary = data[SUMMARY_KEY];
  const detailEntries = Object.entries(data).filter(
    ([key]) => key !== SUMMARY_KEY,
  );

  if (!summary && detailEntries.length === 0) return null;

  return (
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
  );
};

type AdvisorTranscriptMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: Date | string;
};

type AdvisorTranscriptMessagesProps = {
  messages: AdvisorTranscriptMessage[];
};

/** Role-styled chat bubbles for an advisor conversation transcript. */
export const AdvisorTranscriptMessages = ({
  messages,
}: AdvisorTranscriptMessagesProps) => {
  const format = useFormatter();

  // Hide the internal verification kickoff signal from the merchant transcript.
  const visibleMessages = messages.filter(
    (message) =>
      !(
        message.role === 'user' &&
        message.content === VERIFICATION_KICKOFF_PROMPT
      ),
  );

  return (
    <div className="space-y-4">
      {visibleMessages.map((message) => (
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
  );
};
