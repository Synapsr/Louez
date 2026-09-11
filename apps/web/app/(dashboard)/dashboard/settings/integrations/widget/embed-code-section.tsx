"use client";

import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@louez/ui";
import { CodeIcon, ExternalLinkIcon, EyeIcon } from "@louez/ui/icons";

import { CopyButton } from "@/components/ui/copy-button";
import { EMBED_INITIAL_HEIGHT } from "@/lib/embed/embed-widget.constants";
import { readEmbedResizeHeight } from "@/lib/embed/util.embed-messaging";
import { buildEmbedSnippet } from "@/lib/embed/util.embed-snippet";

interface EmbedCodeSectionProps {
  embedUrl: string;
  storeName: string;
}

export function EmbedCodeSection({ embedUrl, storeName }: EmbedCodeSectionProps) {
  const t = useTranslations("dashboard.settings.embed");
  const previewIframeRef = useRef<HTMLIFrameElement>(null);

  // Auto-resize preview iframe via postMessage from embed
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const height = readEmbedResizeHeight(event.data);
      if (height !== null && previewIframeRef.current) {
        previewIframeRef.current.style.height = `${height}px`;
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  const embedSnippet = buildEmbedSnippet({
    embedUrl,
    iframeTitle: t("iframeTitle", { storeName }),
    variant: "auto",
  });

  return (
    <div className="space-y-6">
      {/* Preview */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <EyeIcon className="h-5 w-5 shrink-0" />
            {t("preview")}
          </CardTitle>
          <CardDescription>{t("previewDescription")}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-xl border bg-muted/30 p-6 flex justify-center">
            <iframe
              ref={previewIframeRef}
              src={embedUrl}
              width="100%"
              height={EMBED_INITIAL_HEIGHT}
              style={{
                border: "none",
                borderRadius: "16px",
                maxWidth: "600px",
                transition: "height 0.3s ease",
              }}
              title={t("iframeTitle", { storeName })}
            />
          </div>
        </CardContent>
      </Card>

      {/* Code */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CodeIcon className="h-5 w-5 shrink-0" />
            {t("code")}
          </CardTitle>
          <CardDescription>{t("codeDescription")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Code block */}
          <div className="relative">
            <pre className="rounded-lg bg-muted p-4 text-sm text-muted-foreground overflow-x-auto">
              <code>{embedSnippet}</code>
            </pre>
            <CopyButton
              value={embedSnippet}
              label={t("copy")}
              copiedLabel={t("copied")}
              size="sm"
              variant="secondary"
              className="absolute top-2 right-2"
            />
          </div>

          {/* Direct link */}
          <div className="flex items-center gap-2 pt-2">
            <span className="text-sm text-muted-foreground">{t("directLink")}</span>
            <a
              href={embedUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-primary hover:underline inline-flex items-center gap-1"
            >
              {embedUrl}
              <ExternalLinkIcon className="h-3 w-3" />
            </a>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
