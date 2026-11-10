"use client";

import { useEffect, useRef, useState } from "react";

import {
  Check,
  ChevronRight,
  Copy,
  Download,
  Mail,
  MessageCircle,
  Share2,
  Smartphone,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { QRCodeSVG } from "qrcode.react";

import {
  Button,
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
  Label,
  Textarea,
} from "@louez/ui";

const COPIED_FEEDBACK_MS = 1800;
const QR_EXPORT_SIZE = 480;
const QR_EXPORT_PADDING = 48;

interface ShareModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  storeUrl: string;
  storeName?: string;
}

/** "Maison Pointure" → "maison-pointure", for the QR code file name. */
const toFileSlug = (name: string) =>
  name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "boutique";

/** Copies text, and says for a moment that it did. */
const useCopied = () => {
  const [copied, setCopied] = useState(false);
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), COPIED_FEEDBACK_MS);
    } catch {
      // Clipboard refused (permissions, old browser): the text stays selectable.
    }
  };
  return { copied, copy };
};

/**
 * Everything to send the store out, in one view: the address with its copy
 * button, a message the owner can adjust before it leaves, the channels that
 * send that message, and the QR code — always there, ready to print for the
 * counter or a flyer. On a phone the system share sheet comes first.
 */
export function ShareModal({ open, onOpenChange, storeUrl, storeName }: ShareModalProps) {
  const t = useTranslations("dashboard.home.share");
  const qrRef = useRef<HTMLDivElement>(null);
  const link = useCopied();
  const text = useCopied();
  const [message, setMessage] = useState(() => t("whatsappMessage", { url: storeUrl }));
  // The system sheet exists on phones (and a few desktops): only offered there.
  const [canNativeShare, setCanNativeShare] = useState(false);

  useEffect(() => {
    // Touch devices only: on a desktop the channels below already cover it,
    // and a second "share" entry there only blurs the choice.
    setCanNativeShare(
      typeof navigator.share === "function" && window.matchMedia("(pointer: coarse)").matches,
    );
  }, []);

  // A fresh, untouched message each time the sheet opens.
  useEffect(() => {
    if (open) setMessage(t("whatsappMessage", { url: storeUrl }));
  }, [open, storeUrl, t]);

  const openExternal = (href: string) => window.open(href, "_blank", "noopener,noreferrer");

  const channels = [
    {
      key: "whatsapp",
      label: "WhatsApp",
      icon: MessageCircle,
      onClick: () => openExternal(`https://wa.me/?text=${encodeURIComponent(message)}`),
    },
    {
      key: "email",
      label: t("email"),
      icon: Mail,
      onClick: () =>
        openExternal(
          `mailto:?subject=${encodeURIComponent(t("emailSubject"))}&body=${encodeURIComponent(message)}`,
        ),
    },
    {
      key: "sms",
      label: "SMS",
      icon: Smartphone,
      onClick: () => openExternal(`sms:?body=${encodeURIComponent(message)}`),
    },
  ];

  const handleNativeShare = async () => {
    try {
      await navigator.share({ title: storeName, text: message, url: storeUrl });
    } catch {
      // Dismissed by the user: nothing to do.
    }
  };

  const handleDownloadQR = () => {
    const svg = qrRef.current?.querySelector("svg");
    if (!svg) return;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    const image = new Image();
    canvas.width = QR_EXPORT_SIZE + QR_EXPORT_PADDING * 2;
    canvas.height = QR_EXPORT_SIZE + QR_EXPORT_PADDING * 2;
    image.onload = () => {
      if (!ctx) return;
      ctx.fillStyle = "white";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, QR_EXPORT_PADDING, QR_EXPORT_PADDING, QR_EXPORT_SIZE, QR_EXPORT_SIZE);
      const anchor = document.createElement("a");
      anchor.download = `qr-code-${toFileSlug(storeName ?? "")}.png`;
      anchor.href = canvas.toDataURL("image/png");
      anchor.click();
    };
    const svgData = new XMLSerializer().serializeToString(svg);
    image.src = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svgData)))}`;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPopup className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>{t("description")}</DialogDescription>
        </DialogHeader>

        <DialogPanel>
          <div className="grid gap-6 sm:grid-cols-[minmax(0,1fr)_13rem]">
            <div className="flex min-w-0 flex-col gap-5">
              {/* The address, copied in one click. */}
              <div className="bg-muted/40 flex items-center gap-2 rounded-xl border p-1.5 ps-3">
                <span className="min-w-0 flex-1 truncate font-mono text-sm">{storeUrl}</span>
                <Button
                  size="sm"
                  variant={link.copied ? "outline" : "default"}
                  onClick={() => link.copy(storeUrl)}
                >
                  {link.copied ? <Check className="text-success" /> : <Copy />}
                  {link.copied ? t("copied") : t("copyShort")}
                </Button>
              </div>

              {/* The channels, as the apps people know show them: round icons,
                  their name underneath, the prepared message sent as is. */}
              <div className="flex flex-col gap-2">
                <p className="text-sm font-semibold">{t("sendVia")}</p>
                <div className="flex flex-wrap gap-x-2 gap-y-3">
                  {[
                    ...(canNativeShare
                      ? [
                          {
                            key: "native",
                            label: t("nativeShareShort"),
                            icon: Share2,
                            onClick: handleNativeShare,
                          },
                        ]
                      : []),
                    ...channels,
                    {
                      key: "copy-message",
                      label: text.copied ? t("messageCopied") : t("copyMessage"),
                      icon: text.copied ? Check : Copy,
                      onClick: () => text.copy(message),
                    },
                  ].map((channel) => (
                    <button
                      key={channel.key}
                      type="button"
                      onClick={channel.onClick}
                      className="group focus-visible:ring-ring flex w-18 flex-col items-center gap-1.5 rounded-xl py-1 text-center focus-visible:ring-2 focus-visible:outline-none"
                    >
                      <span className="bg-muted text-foreground group-hover:bg-accent group-hover:text-primary flex size-11 items-center justify-center rounded-full transition-colors duration-150">
                        <channel.icon className="size-5" />
                      </span>
                      <span className="text-muted-foreground group-hover:text-foreground text-xs leading-tight font-medium">
                        {channel.label}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              {/* The message, ready as is; whoever wants to adjust it can. */}
              <details className="group/msg rounded-xl border">
                <summary className="text-muted-foreground hover:text-foreground flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 text-sm font-medium [&::-webkit-details-marker]:hidden">
                  <ChevronRight className="size-4 transition-transform duration-150 group-open/msg:rotate-90" />
                  {t("customizeMessage")}
                </summary>
                <div className="flex flex-col gap-1.5 px-3 pb-3">
                  <Label htmlFor="share-store-message" className="sr-only">
                    {t("messageLabel")}
                  </Label>
                  <Textarea
                    id="share-store-message"
                    value={message}
                    onChange={(event) => setMessage(event.target.value)}
                    rows={3}
                    className="text-sm [&_textarea]:resize-none"
                  />
                  <p className="text-muted-foreground text-xs">{t("messageHint")}</p>
                </div>
              </details>
            </div>

            {/* The QR code, always in view: for the counter, a flyer, the window. */}
            <div className="bg-muted/40 flex flex-col items-center gap-3 rounded-xl border p-4 text-center">
              <div ref={qrRef} className="rounded-xl bg-white p-3 shadow-sm ring-1 ring-black/5">
                <QRCodeSVG
                  value={storeUrl}
                  size={148}
                  level="H"
                  marginSize={0}
                  bgColor="#ffffff"
                  fgColor="#000000"
                />
              </div>
              <p className="text-muted-foreground text-xs text-balance">{t("qrHint")}</p>
              <Button size="sm" variant="outline" onClick={handleDownloadQR} className="w-full">
                <Download />
                {t("downloadPng")}
              </Button>
            </div>
          </div>
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  );
}
