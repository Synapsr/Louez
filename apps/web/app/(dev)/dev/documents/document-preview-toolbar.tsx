"use client";

import { ExternalLinkIcon, MonitorIcon, RefreshCwIcon, SmartphoneIcon } from "lucide-react";

import {
  Badge,
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Toggle,
  ToggleGroup,
} from "@louez/ui";

import { DOCUMENT_PREVIEW_LOCALE_LABELS } from "@/lib/document-previews/document-previews.fixtures";
import type { EmailLocale } from "@/lib/email/i18n";

export type PreviewViewport = "desktop" | "mobile";

interface DocumentPreviewToolbarProps {
  document: {
    kind: "email" | "pdf";
    title: string;
    description: string;
    locales: readonly EmailLocale[];
  };
  subject: string | null;
  stores: readonly { id: string; label: string }[];
  storeId: string;
  locale: EmailLocale;
  viewport: PreviewViewport;
  openUrl: string;
  onStoreChange: (storeId: string) => void;
  onLocaleChange: (locale: EmailLocale) => void;
  onViewportChange: (viewport: PreviewViewport) => void;
  onRefresh: () => void;
}

export const DocumentPreviewToolbar = ({
  document,
  subject,
  stores,
  storeId,
  locale,
  viewport,
  openUrl,
  onStoreChange,
  onLocaleChange,
  onViewportChange,
  onRefresh,
}: DocumentPreviewToolbarProps) => {
  const storeLabel = stores.find((store) => store.id === storeId)?.label;

  return (
    <header className="flex flex-wrap items-start justify-between gap-4 border-b bg-background px-6 py-4">
      <div className="min-w-0 space-y-1">
        <div className="flex items-center gap-2">
          <h2 className="truncate text-lg font-semibold">{document.title}</h2>
          <Badge variant="outline">{document.kind === "email" ? "Email" : "PDF"}</Badge>
        </div>
        <p className="text-sm text-muted-foreground">{document.description}</p>
        {subject ? (
          <p className="text-sm">
            <span className="text-muted-foreground">Objet : </span>
            <span className="font-medium">{subject}</span>
          </p>
        ) : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Select value={storeId} onValueChange={(value) => value && onStoreChange(String(value))}>
          <SelectTrigger size="sm" className="w-52" aria-label="Boutique fictive">
            <SelectValue>{storeLabel}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {stores.map((store) => (
              <SelectItem key={store.id} value={store.id} label={store.label}>
                {store.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select
          value={locale}
          onValueChange={(value) => value && onLocaleChange(value as EmailLocale)}
        >
          <SelectTrigger size="sm" className="w-40" aria-label="Langue">
            <SelectValue>{DOCUMENT_PREVIEW_LOCALE_LABELS[locale]}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {document.locales.map((option) => (
              <SelectItem
                key={option}
                value={option}
                label={DOCUMENT_PREVIEW_LOCALE_LABELS[option]}
              >
                {DOCUMENT_PREVIEW_LOCALE_LABELS[option]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {document.kind === "email" ? (
          <ToggleGroup
            variant="outline"
            size="sm"
            value={[viewport]}
            onValueChange={(values) => {
              const next = values[0];
              if (next === "desktop" || next === "mobile") onViewportChange(next);
            }}
            aria-label="Largeur d'affichage"
          >
            <Toggle value="desktop" aria-label="Bureau">
              <MonitorIcon />
            </Toggle>
            <Toggle value="mobile" aria-label="Mobile">
              <SmartphoneIcon />
            </Toggle>
          </ToggleGroup>
        ) : null}

        <Button variant="outline" size="sm" onClick={onRefresh}>
          <RefreshCwIcon />
          Rafraîchir
        </Button>
        <Button
          variant="outline"
          size="sm"
          render={<a href={openUrl} target="_blank" rel="noreferrer" />}
        >
          <ExternalLinkIcon />
          Ouvrir
        </Button>
      </div>
    </header>
  );
};
