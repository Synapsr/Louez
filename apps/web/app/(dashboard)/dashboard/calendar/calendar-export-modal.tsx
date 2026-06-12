'use client';

import { useEffect, useState } from 'react';

import Link from 'next/link';

import {
  CalendarCheck,
  Check,
  Copy,
  ExternalLink,
  RefreshCw,
} from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button } from '@louez/ui';
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPopup,
  DialogTitle,
} from '@louez/ui';
import { Input } from '@louez/ui';
import { Label } from '@louez/ui';

import { getIcsToken, regenerateIcsToken } from './actions';

interface CalendarExportModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  storeId: string;
}

export function CalendarExportModal({
  open,
  onOpenChange,
  storeId,
}: CalendarExportModalProps) {
  const t = useTranslations('dashboard.calendar.export');
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [regenerating, setRegenerating] = useState(false);

  // Fetch token when modal opens
  useEffect(() => {
    const fetchToken = async () => {
      setLoading(true);
      const result = await getIcsToken();
      if (result.success && result.token) {
        setToken(result.token);
      }
      setLoading(false);
    };

    if (open && !token) {
      fetchToken();
    }
  }, [open, token]);

  const handleRegenerate = async () => {
    setRegenerating(true);
    const result = await regenerateIcsToken();
    if (result.success && result.token) {
      setToken(result.token);
    }
    setRegenerating(false);
  };

  const getIcsUrl = () => {
    const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';
    return `${baseUrl}/api/calendar/ics?store=${storeId}&token=${token}`;
  };

  const handleCopy = async () => {
    if (!token) return;
    try {
      await navigator.clipboard.writeText(getIcsUrl());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for browsers that don't support clipboard API
      const input = document.querySelector<HTMLInputElement>('#ics-url-input');
      if (input) {
        input.select();
        document.execCommand('copy');
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="flex max-h-[min(720px,calc(100vh-2rem))] flex-col overflow-hidden p-0 sm:max-w-xl">
        <DialogHeader className="border-b px-5 pt-5 pb-4 sm:px-6 sm:pt-6">
          <DialogTitle>{t('title')}</DialogTitle>
          <DialogDescription>{t('description')}</DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5 sm:px-6">
          <div className="space-y-3 rounded-md border p-4">
            <div className="flex items-start gap-3">
              <div className="bg-primary/10 text-primary flex h-8 w-8 shrink-0 items-center justify-center rounded-md">
                <CalendarCheck className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1 space-y-1">
                <h4 className="text-sm font-medium">
                  {t('integration.title')}
                </h4>
                <p className="text-muted-foreground text-sm">
                  {t('integration.description')}
                </p>
              </div>
            </div>
            <Button
              className="w-full sm:w-auto"
              render={
                <Link href="/dashboard/settings/integrations/google-calendar" />
              }
            >
              {t('integration.button')}
            </Button>
          </div>

          <div className="space-y-3 rounded-md border p-4">
            <div>
              <h4 className="text-sm font-medium">{t('ics.title')}</h4>
              <p className="text-muted-foreground text-sm">
                {t('ics.description')}
              </p>
            </div>

            <Label htmlFor="ics-url-input">{t('urlLabel')}</Label>
            <div className="flex gap-2">
              <Input
                id="ics-url-input"
                value={loading ? t('loading') : token ? getIcsUrl() : ''}
                readOnly
                className="font-mono text-xs"
              />
              <Button
                variant="outline"
                size="icon"
                onClick={handleCopy}
                disabled={!token || loading}
              >
                {copied ? (
                  <Check className="h-4 w-4 text-green-500" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>

          {/* Instructions */}
          <div className="space-y-3">
            <h4 className="text-sm font-medium">{t('instructions.title')}</h4>

            {/* Google Calendar */}
            <div className="space-y-2 rounded-md border p-3">
              <div className="flex items-start gap-3">
                <div className="bg-primary text-primary-foreground flex h-6 w-6 shrink-0 items-center justify-center rounded text-xs font-bold">
                  G
                </div>
                <div className="min-w-0 flex-1 space-y-2">
                  <span className="text-sm font-medium">Google Calendar</span>
                  <ol className="text-muted-foreground list-decimal space-y-1 pl-4 text-xs">
                    <li>{t('instructions.google.step1')}</li>
                    <li>{t('instructions.google.step2')}</li>
                    <li>{t('instructions.google.step3')}</li>
                  </ol>
                  <a
                    href="https://calendar.google.com/calendar/r/settings/addbyurl"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary inline-flex items-center gap-1 text-xs hover:underline"
                  >
                    {t('instructions.google.openLink')}
                    <ExternalLink className="h-3 w-3" />
                  </a>
                  <p className="text-muted-foreground text-xs">
                    {t('instructions.google.freshnessNote')}
                  </p>
                </div>
              </div>
            </div>

            {/* Apple Calendar */}
            <div className="space-y-2 rounded-md border p-3">
              <div className="flex items-start gap-3">
                <div className="bg-muted text-foreground flex h-6 w-6 shrink-0 items-center justify-center rounded text-xs font-bold">
                  A
                </div>
                <div className="min-w-0 flex-1 space-y-2">
                  <span className="text-sm font-medium">Apple Calendar</span>
                  <ol className="text-muted-foreground list-decimal space-y-1 pl-4 text-xs">
                    <li>{t('instructions.apple.step1')}</li>
                    <li>{t('instructions.apple.step2')}</li>
                    <li>{t('instructions.apple.step3')}</li>
                  </ol>
                </div>
              </div>
            </div>

            {/* Outlook */}
            <div className="space-y-2 rounded-md border p-3">
              <div className="flex items-start gap-3">
                <div className="bg-muted text-foreground flex h-6 w-6 shrink-0 items-center justify-center rounded text-xs font-bold">
                  O
                </div>
                <div className="min-w-0 flex-1 space-y-2">
                  <span className="text-sm font-medium">Outlook</span>
                  <ol className="text-muted-foreground list-decimal space-y-1 pl-4 text-xs">
                    <li>{t('instructions.outlook.step1')}</li>
                    <li>{t('instructions.outlook.step2')}</li>
                    <li>{t('instructions.outlook.step3')}</li>
                  </ol>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-3 border-t px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p className="text-muted-foreground text-xs">{t('regenerateHint')}</p>
          <Button
            variant="ghost"
            className="justify-start sm:justify-center"
            onClick={handleRegenerate}
            disabled={regenerating}
          >
            <RefreshCw
              className={`mr-2 h-4 w-4 ${regenerating ? 'animate-spin' : ''}`}
            />
            {t('regenerate')}
          </Button>
        </div>
      </DialogPopup>
    </Dialog>
  );
}
