"use client";

import { cn } from "@louez/utils";

import {
  EMBED_HOST_THEME_CLASSNAMES,
  type EmbedHostThemeId,
  type EmbedIntegrationId,
  type EmbedPlacementId,
} from "./embed-playground.constants";

interface EmbedHostPreviewProps {
  storeName: string;
  embedUrl: string;
  integration: EmbedIntegrationId;
  placement: EmbedPlacementId;
  hostTheme: EmbedHostThemeId;
  /** Bumped on reload and on every change that must remount the iframe. */
  frameKey: string;
  /** `null` lets the iframe fill the simulated viewport (direct page). */
  frameHeight: number | null;
}

const HOST_DOMAIN = "www.site-du-loueur.fr";

/**
 * A stand-in merchant site around the widget. Its own layout reacts to the
 * simulated width through container queries, never through the real window,
 * so what you see at 390 px is what a phone would get.
 */
export const EmbedHostPreview = ({
  storeName,
  embedUrl,
  integration,
  placement,
  hostTheme,
  frameKey,
  frameHeight,
}: EmbedHostPreviewProps) => {
  const iframe = (
    <iframe
      key={frameKey}
      src={embedUrl}
      title={`Widget de réservation — ${storeName}`}
      allow="popups"
      className={cn(
        "w-full border-0",
        frameHeight === null ? "h-full" : "rounded-2xl transition-[height] duration-300",
      )}
      style={frameHeight === null ? undefined : { height: `${frameHeight}px` }}
    />
  );

  if (integration === "standalone") {
    return (
      <div className="h-full overflow-hidden rounded-xl border bg-background shadow-sm">
        {iframe}
      </div>
    );
  }

  const isDark = hostTheme === "dark";
  const mutedText = isDark ? "text-neutral-400" : "text-neutral-500";
  const blockBackground = isDark ? "bg-neutral-800" : "bg-neutral-100";

  const paragraph = (className?: string) => (
    <div className={cn("space-y-2", className)}>
      {["w-full", "w-11/12", "w-9/12"].map((width) => (
        <div key={width} className={cn("h-2.5 rounded-full", blockBackground, width)} />
      ))}
    </div>
  );

  const body = {
    full: (
      <div className="space-y-6 p-6 @lg:p-10">
        <div className="space-y-3">
          <h2 className="text-2xl font-semibold @lg:text-3xl">Louez votre matériel</h2>
          {paragraph("max-w-xl")}
        </div>
        <div className="mx-auto w-full max-w-[600px]">{iframe}</div>
        {paragraph()}
      </div>
    ),
    sidebar: (
      <div className="grid gap-6 p-6 @lg:grid-cols-[1fr_320px] @lg:p-10">
        <div className="space-y-4">
          <h2 className="text-2xl font-semibold">Notre matériel</h2>
          {paragraph()}
          <div className={cn("h-40 rounded-xl", blockBackground)} />
          {paragraph()}
        </div>
        <aside className="@lg:sticky @lg:top-6 @lg:self-start">{iframe}</aside>
      </div>
    ),
    hero: (
      <div>
        <div
          className={cn(
            "space-y-4 px-6 py-10 @lg:px-10 @lg:py-16",
            isDark ? "bg-neutral-800" : "bg-neutral-900 text-white",
          )}
        >
          <h2 className="text-3xl font-semibold @lg:text-4xl">Réservez en deux minutes</h2>
          <p className="max-w-lg text-sm opacity-80">
            Matériel disponible sept jours sur sept, retrait sur place ou livraison.
          </p>
          <div className="w-full max-w-[600px] pt-2">{iframe}</div>
        </div>
        <div className="space-y-4 p-6 @lg:p-10">{paragraph()}</div>
      </div>
    ),
  }[placement];

  return (
    <div className="overflow-hidden rounded-xl border shadow-sm">
      {/* Fake browser chrome, so the widget is read in the context of a site. */}
      <div
        className={cn(
          "flex items-center gap-2 border-b px-3 py-2",
          isDark ? "border-neutral-700 bg-neutral-800" : "border-neutral-200 bg-neutral-50",
        )}
      >
        <div className="flex gap-1.5">
          {["bg-red-400", "bg-amber-400", "bg-green-400"].map((color) => (
            <span key={color} className={cn("size-2.5 rounded-full", color)} />
          ))}
        </div>
        <span className={cn("truncate text-xs", isDark ? "text-neutral-400" : "text-neutral-500")}>
          {HOST_DOMAIN}
        </span>
      </div>

      <div className={EMBED_HOST_THEME_CLASSNAMES[hostTheme]}>
        <header
          className={cn(
            "flex items-center justify-between border-b px-6 py-4",
            isDark ? "border-neutral-800" : "border-neutral-200",
          )}
        >
          <span className="text-sm font-semibold">{storeName}</span>
          <nav className={cn("hidden gap-4 text-xs @md:flex", mutedText)}>
            <span>Accueil</span>
            <span>Matériel</span>
            <span>Contact</span>
          </nav>
        </header>

        {body}

        <footer
          className={cn(
            "border-t px-6 py-4 text-xs",
            mutedText,
            isDark ? "border-neutral-800" : "border-neutral-200",
          )}
        >
          © {HOST_DOMAIN}
        </footer>
      </div>
    </div>
  );
};
