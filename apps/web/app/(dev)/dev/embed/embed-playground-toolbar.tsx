"use client";

import {
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Slider,
  Toggle,
  ToggleGroup,
} from "@louez/ui";
import { ExternalLinkIcon, MoonIcon, RepeatSolidIcon, SunIcon } from "@louez/ui/icons";

import {
  EMBED_INTEGRATIONS,
  EMBED_PLACEMENTS,
  EMBED_VIEWPORT_MAX_WIDTH,
  EMBED_VIEWPORT_MIN_WIDTH,
  EMBED_VIEWPORT_PRESETS,
  type EmbedHostThemeId,
  type EmbedIntegrationId,
  type EmbedPlacementId,
} from "./embed-playground.constants";

export interface PlaygroundStore {
  slug: string;
  name: string;
  embedUrl: string;
}

interface EmbedPlaygroundToolbarProps {
  stores: readonly PlaygroundStore[];
  store: PlaygroundStore;
  integration: EmbedIntegrationId;
  placement: EmbedPlacementId;
  /** `null` renders at the width of the preview pane. */
  width: number | null;
  hostTheme: EmbedHostThemeId;
  onStoreChange: (slug: string) => void;
  onIntegrationChange: (integration: EmbedIntegrationId) => void;
  onPlacementChange: (placement: EmbedPlacementId) => void;
  onWidthChange: (width: number | null) => void;
  onHostThemeChange: (hostTheme: EmbedHostThemeId) => void;
  onReload: () => void;
}

const isIntegrationId = (value: string): value is EmbedIntegrationId =>
  EMBED_INTEGRATIONS.some((integration) => integration.id === value);

const isPlacementId = (value: string): value is EmbedPlacementId =>
  EMBED_PLACEMENTS.some((placement) => placement.id === value);

export const EmbedPlaygroundToolbar = ({
  stores,
  store,
  integration,
  placement,
  width,
  hostTheme,
  onStoreChange,
  onIntegrationChange,
  onPlacementChange,
  onWidthChange,
  onHostThemeChange,
  onReload,
}: EmbedPlaygroundToolbarProps) => {
  const integrationOption = EMBED_INTEGRATIONS.find((option) => option.id === integration);
  const isStandalone = integration === "standalone";

  return (
    <header className="space-y-3 border-b bg-background px-6 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={store.slug} onValueChange={(value) => value && onStoreChange(String(value))}>
          <SelectTrigger size="sm" className="w-56" aria-label="Boutique">
            <SelectValue>{store.name}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {stores.map((option) => (
              <SelectItem key={option.slug} value={option.slug} label={option.name}>
                {option.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <ToggleGroup
          variant="outline"
          size="sm"
          value={[integration]}
          onValueChange={(values) => {
            const next = values[0];
            if (typeof next === "string" && isIntegrationId(next)) onIntegrationChange(next);
          }}
          aria-label="Intégration"
        >
          {EMBED_INTEGRATIONS.map((option) => (
            <Toggle key={option.id} value={option.id}>
              {option.label}
            </Toggle>
          ))}
        </ToggleGroup>

        <ToggleGroup
          variant="outline"
          size="sm"
          value={[placement]}
          onValueChange={(values) => {
            const next = values[0];
            if (typeof next === "string" && isPlacementId(next)) onPlacementChange(next);
          }}
          aria-label="Emplacement sur la page"
          disabled={isStandalone}
        >
          {EMBED_PLACEMENTS.map((option) => (
            <Toggle key={option.id} value={option.id}>
              {option.label}
            </Toggle>
          ))}
        </ToggleGroup>

        <ToggleGroup
          variant="outline"
          size="sm"
          value={[hostTheme]}
          onValueChange={(values) => {
            const next = values[0];
            if (next === "light" || next === "dark") onHostThemeChange(next);
          }}
          aria-label="Thème du site hôte"
          disabled={isStandalone}
        >
          <Toggle value="light" aria-label="Site clair">
            <SunIcon />
          </Toggle>
          <Toggle value="dark" aria-label="Site sombre">
            <MoonIcon />
          </Toggle>
        </ToggleGroup>

        <div className="ms-auto flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={onReload}>
            <RepeatSolidIcon />
            Recharger
          </Button>
          <Button
            variant="outline"
            size="sm"
            render={<a href={store.embedUrl} target="_blank" rel="noreferrer" />}
          >
            <ExternalLinkIcon />
            Ouvrir
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <ToggleGroup
          variant="outline"
          size="sm"
          value={[EMBED_VIEWPORT_PRESETS.find((preset) => preset.width === width)?.id ?? "custom"]}
          onValueChange={(values) => {
            const preset = EMBED_VIEWPORT_PRESETS.find((option) => option.id === values[0]);
            if (preset) onWidthChange(preset.width);
          }}
          aria-label="Largeur d'écran"
        >
          {EMBED_VIEWPORT_PRESETS.map((preset) => (
            <Toggle key={preset.id} value={preset.id}>
              {preset.label}
              {preset.width ? <span className="text-muted-foreground">{preset.width}</span> : null}
            </Toggle>
          ))}
        </ToggleGroup>

        <Slider
          value={[width ?? EMBED_VIEWPORT_MAX_WIDTH]}
          onValueChange={(value) => onWidthChange(Array.isArray(value) ? value[0] : value)}
          min={EMBED_VIEWPORT_MIN_WIDTH}
          max={EMBED_VIEWPORT_MAX_WIDTH}
          step={10}
          className="w-56"
          aria-label="Largeur personnalisée"
        />
        <span className="w-24 text-sm tabular-nums text-muted-foreground">
          {width === null ? "Fluide" : `${width} px`}
        </span>

        {integrationOption ? (
          <p className="text-sm text-muted-foreground">{integrationOption.description}</p>
        ) : null}
      </div>
    </header>
  );
};
