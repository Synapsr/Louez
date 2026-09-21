"use client";

import { useEffect, useState } from "react";

import Link from "next/link";

import { useTranslations } from "next-intl";

import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
  AlertDialogTrigger,
  Badge,
  Button,
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@louez/ui";
import {
  CheckIcon,
  CopyIcon,
  GoogleCalendarIcon,
  InfoCircleIcon,
  OpenInNewIcon,
  RepeatSolidIcon,
} from "@louez/ui/icons";

import { getCalendarSyncState, regenerateIcsToken } from "./actions";
import { useStoreHasPermission } from "@/contexts/store-context";

interface CalendarExportModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  storeId: string;
}

/** Short helper bubble — details live here instead of taking room in the dialog. */
function InfoTooltip({ label }: { label: string }) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger
          render={<InfoCircleIcon className="text-muted-foreground size-3.5 cursor-help" />}
        />
        <TooltipContent side="top" className="max-w-xs">
          <p>{label}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

/** One-click subscription button; disabled until the ICS link is known. */
function SubscribeButton({ href, label }: { href: string | null; label: string }) {
  if (!href) {
    return (
      <Button variant="outline" size="sm" disabled>
        {label}
      </Button>
    );
  }

  return (
    <Button
      variant="outline"
      size="sm"
      render={<a href={href} target="_blank" rel="noopener noreferrer" />}
    >
      {label}
      <OpenInNewIcon data-slot="icon" />
    </Button>
  );
}

export function CalendarExportModal({ open, onOpenChange, storeId }: CalendarExportModalProps) {
  const canManage = useStoreHasPermission("manage_settings");
  const t = useTranslations("dashboard.calendar.export");
  const [token, setToken] = useState<string | null>(null);
  const [googleConnected, setGoogleConnected] = useState(false);
  const [copied, setCopied] = useState(false);
  const [regenerating, setRegenerating] = useState(false);

  // Load the ICS token (creating one on first open) plus the Google connection
  // state, so the primary action can read "connect" or "manage".
  useEffect(() => {
    if (!open || token) return;

    let mounted = true;

    const loadState = async () => {
      const result = await getCalendarSyncState();
      if (!mounted || !("success" in result)) return;
      setToken(result.token);
      setGoogleConnected(result.googleConnected);
    };

    void loadState();

    return () => {
      mounted = false;
    };
  }, [open, token]);

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const icsUrl = token ? `${origin}/api/calendar/ics?store=${storeId}&token=${token}` : null;
  const webcalUrl = icsUrl ? icsUrl.replace(/^https?:/, "webcal:") : null;
  const googleUrl = webcalUrl
    ? `https://calendar.google.com/calendar/render?cid=${encodeURIComponent(webcalUrl)}`
    : null;
  const outlookUrl = icsUrl
    ? `https://outlook.live.com/calendar/0/addfromweb?url=${encodeURIComponent(icsUrl)}&name=Louez`
    : null;

  const handleCopy = async () => {
    if (!icsUrl) return;
    try {
      await navigator.clipboard.writeText(icsUrl);
    } catch {
      // Fallback for browsers without the async clipboard API.
      const textarea = document.createElement("textarea");
      textarea.value = icsUrl;
      textarea.setAttribute("readonly", "");
      textarea.className = "sr-only";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleRegenerate = async () => {
    if (!canManage) return;
    setRegenerating(true);
    const result = await regenerateIcsToken();
    if (result.success && result.token) {
      setToken(result.token);
    }
    setRegenerating(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>

        <DialogPanel className="space-y-5">
          {/* Recommended path — the real integration */}
          <div className="flex items-center gap-3 rounded-lg border p-3">
            <GoogleCalendarIcon className="size-7 shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-medium">{t("google.title")}</span>
                <Badge variant={googleConnected ? "success" : "progress"} size="sm">
                  {googleConnected ? t("google.connected") : t("google.recommended")}
                </Badge>
                <InfoTooltip label={t("google.help")} />
              </div>
            </div>
            <Button
              size="sm"
              variant={googleConnected ? "outline" : "default"}
              render={<Link href="/dashboard/settings/integrations/google-calendar" />}
            >
              {googleConnected ? t("google.manage") : t("google.connect")}
            </Button>
          </div>

          {/* Everything else — one click per calendar app */}
          <div className="space-y-2">
            <div className="flex items-center gap-1.5">
              <h3 className="text-sm font-medium">{t("subscribe.title")}</h3>
              <InfoTooltip label={t("subscribe.help")} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <SubscribeButton href={webcalUrl} label={t("subscribe.apple")} />
              <SubscribeButton href={outlookUrl} label={t("subscribe.outlook")} />
              <SubscribeButton href={googleUrl} label={t("subscribe.google")} />
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button variant="outline" size="sm" onClick={handleCopy} disabled={!icsUrl} />
                    }
                  >
                    {copied ? (
                      <CheckIcon data-slot="icon" className="text-success" />
                    ) : (
                      <CopyIcon data-slot="icon" />
                    )}
                    {copied ? t("subscribe.copied") : t("subscribe.copy")}
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-xs">
                    <p className="font-mono break-all">{icsUrl ?? t("loading")}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          </div>
        </DialogPanel>

        <DialogFooter className="sm:justify-between">
          {canManage && <AlertDialog>
            <AlertDialogTrigger
              render={<Button variant="ghost" size="sm" isPending={regenerating} />}
            >
              <RepeatSolidIcon data-slot="icon" />
              {t("regenerate.action")}
            </AlertDialogTrigger>
            <AlertDialogPopup className="sm:max-w-sm">
              <AlertDialogHeader>
                <AlertDialogTitle>{t("regenerate.confirmTitle")}</AlertDialogTitle>
                <AlertDialogDescription>{t("regenerate.hint")}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogClose render={<Button variant="outline" />}>
                  {t("cancel")}
                </AlertDialogClose>
                <AlertDialogClose
                  render={<Button variant="destructive" onClick={handleRegenerate} />}
                >
                  {t("regenerate.action")}
                </AlertDialogClose>
              </AlertDialogFooter>
            </AlertDialogPopup>
          </AlertDialog>}

          <DialogClose render={<Button variant="outline" />}>{t("done")}</DialogClose>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
