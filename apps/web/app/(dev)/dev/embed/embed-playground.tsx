"use client";

import { useEffect, useMemo, useState } from "react";

import { Badge } from "@louez/ui";
import { cn } from "@louez/utils";

import { CopyButton } from "@/components/ui/copy-button";
import { EMBED_INITIAL_HEIGHT, EMBED_STATIC_HEIGHT } from "@/lib/embed/embed-widget.constants";
import { readEmbedResizeHeight } from "@/lib/embed/util.embed-messaging";
import { buildEmbedSnippet } from "@/lib/embed/util.embed-snippet";

import { EmbedHostPreview } from "./embed-host-preview";
import { EmbedPlaygroundToolbar, type PlaygroundStore } from "./embed-playground-toolbar";
import {
  type EmbedHostThemeId,
  type EmbedIntegrationId,
  type EmbedPlacementId,
} from "./embed-playground.constants";

interface EmbedPlaygroundProps {
  stores: readonly PlaygroundStore[];
}

interface ResizeEvent {
  index: number;
  height: number;
  origin: string;
  time: string;
}

/** Enough history to see a resize loop or a jump, short enough to scan. */
const RESIZE_LOG_LENGTH = 12;

const DEFAULT_WIDTH = 1280;

/**
 * Test bench for the storefront widget: every integration, on a simulated
 * merchant page, at any screen width, with the resize messages it posts back.
 */
export const EmbedPlayground = ({ stores }: EmbedPlaygroundProps) => {
  const [storeSlug, setStoreSlug] = useState(stores[0].slug);
  const [integration, setIntegration] = useState<EmbedIntegrationId>("auto");
  const [placement, setPlacement] = useState<EmbedPlacementId>("full");
  const [width, setWidth] = useState<number | null>(DEFAULT_WIDTH);
  const [hostTheme, setHostTheme] = useState<EmbedHostThemeId>("light");
  const [reloadCount, setReloadCount] = useState(0);
  const [resizeEvents, setResizeEvents] = useState<ResizeEvent[]>([]);

  const store = stores.find((candidate) => candidate.slug === storeSlug) ?? stores[0];
  const frameKey = `${store.slug}-${integration}-${reloadCount}`;
  const expectedOrigin = useMemo(() => new URL(store.embedUrl).origin, [store.embedUrl]);

  // A remounted iframe starts its height over: the old log would read as ours.
  useEffect(() => {
    setResizeEvents([]);
  }, [frameKey]);

  // The same listener the merchant snippet installs, plus a log of what arrives.
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const height = readEmbedResizeHeight(event.data);
      if (height === null) return;

      setResizeEvents((events) => [
        {
          index: (events[0]?.index ?? 0) + 1,
          height,
          origin: event.origin,
          time: new Date().toLocaleTimeString("fr-FR"),
        },
        ...events.slice(0, RESIZE_LOG_LENGTH - 1),
      ]);
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  const lastHeight = resizeEvents[0]?.height ?? null;
  const frameHeight = {
    auto: lastHeight ?? EMBED_INITIAL_HEIGHT,
    fixed: EMBED_STATIC_HEIGHT,
    standalone: null,
  }[integration];

  const snippet =
    integration === "standalone"
      ? store.embedUrl
      : buildEmbedSnippet({
          embedUrl: store.embedUrl,
          iframeTitle: `Réserver chez ${store.name}`,
          variant: integration,
        });

  const foreignOrigin = resizeEvents.find((event) => event.origin !== expectedOrigin);

  return (
    <main className="flex h-dvh flex-col bg-muted/20 text-foreground">
      <EmbedPlaygroundToolbar
        stores={stores}
        store={store}
        integration={integration}
        placement={placement}
        width={width}
        hostTheme={hostTheme}
        onStoreChange={setStoreSlug}
        onIntegrationChange={setIntegration}
        onPlacementChange={setPlacement}
        onWidthChange={setWidth}
        onHostThemeChange={setHostTheme}
        onReload={() => setReloadCount((count) => count + 1)}
      />

      <div className="flex min-h-0 flex-1">
        <section className="flex min-w-0 flex-1 justify-center overflow-auto p-6">
          <div
            className={cn("@container", width === null ? "w-full" : "shrink-0")}
            style={width === null ? undefined : { width: `${width}px` }}
          >
            <EmbedHostPreview
              storeName={store.name}
              embedUrl={store.embedUrl}
              integration={integration}
              placement={placement}
              hostTheme={hostTheme}
              frameKey={frameKey}
              frameHeight={frameHeight}
            />
          </div>
        </section>

        <aside className="flex w-96 shrink-0 flex-col gap-4 overflow-auto border-s bg-background p-4">
          <section className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">
                {integration === "standalone" ? "URL du widget" : "Code d'intégration"}
              </h2>
              <CopyButton value={snippet} label="Copier" copiedLabel="Copié" size="sm" />
            </div>
            <pre className="whitespace-pre-wrap break-all rounded-lg bg-muted p-3 text-xs text-muted-foreground">
              <code>{snippet}</code>
            </pre>
          </section>

          <section className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">Messages de redimensionnement</h2>
              <Badge variant="outline">{resizeEvents[0]?.index ?? 0}</Badge>
            </div>

            <p className="text-xs text-muted-foreground">
              {integration === "fixed"
                ? `Le script n'est pas branché : l'iframe reste à ${EMBED_STATIC_HEIGHT} px, quoi que le widget réponde.`
                : integration === "standalone"
                  ? "Page ouverte sans hôte : les messages partent dans le vide."
                  : lastHeight === null
                    ? "En attente du premier message du widget…"
                    : `Hauteur appliquée : ${lastHeight} px.`}
            </p>

            {foreignOrigin ? (
              <p className="text-xs text-destructive">
                Message reçu depuis {foreignOrigin.origin}, attendu {expectedOrigin}.
              </p>
            ) : null}

            <ol className="space-y-1 text-xs tabular-nums text-muted-foreground">
              {resizeEvents.map((event) => (
                <li key={event.index} className="flex items-center justify-between gap-2">
                  <span>
                    #{event.index} · {event.height} px
                  </span>
                  <span>{event.time}</span>
                </li>
              ))}
            </ol>
          </section>
        </aside>
      </div>
    </main>
  );
};
