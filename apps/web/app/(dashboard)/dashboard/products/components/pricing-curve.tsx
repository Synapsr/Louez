"use client";

import { useCallback, useMemo, useState } from "react";

import { ChartSpline, Plus } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Popover, PopoverPopup, PopoverTrigger } from "@louez/ui";
import { formatCurrency } from "@louez/utils";

import { useDurationFormat } from "./use-duration-format";
import {
  type ChartDataPoint,
  type PricingDraft,
  buildHorizonPresets,
  curveValues,
  useHorizonCurve,
} from "./use-pricing-draft";

const STAIRS_PATH = "M1,21 L11,21 L11,13 L22,13 L22,6 L33,6";
const RAMP_PATH = "M1,21 L12,15 L23,10 L33,6";

/** The two calculation modes drawn as shapes, seconding their labels. */
export function ModeGlyph({ mode, className }: { mode: "whole" | "prorated"; className?: string }) {
  return (
    <svg viewBox="0 0 34 24" className={className} fill="none" aria-hidden="true">
      <path
        d={mode === "whole" ? STAIRS_PATH : RAMP_PATH}
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** A sparkline of the current rates, normalised into a unit box. */
export function MiniCurve({
  values,
  className,
  filled = true,
}: {
  values: number[];
  className?: string;
  filled?: boolean;
}) {
  if (values.length < 2) return null;
  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min || 1;
  const points = values.map((value, index) => {
    const x = (index / (values.length - 1)) * 100;
    const y = 28 - ((value - min) / span) * 24;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  return (
    <svg viewBox="0 0 100 30" preserveAspectRatio="none" className={className} aria-hidden="true">
      {filled && (
        <polygon points={`0,30 ${points.join(" ")} 100,30`} fill="currentColor" opacity={0.12} />
      )}
      <polyline
        points={points.join(" ")}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        vectorEffect="non-scaling-stroke"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * The price simulation, reached from a sparkline instead of holding permanent
 * vertical space. Opening it hands over the interactive curve: clicking it drops
 * a rate on the line at that duration, and the horizon chips look past the rates
 * already set — which is where the two calculation modes diverge most.
 */
export function PricingSimulator({
  draft,
  currency,
  disabled,
  align = "start",
  className,
}: {
  draft: PricingDraft;
  currency: string;
  disabled: boolean;
  align?: "start" | "center" | "end";
  className?: string;
}) {
  const t = useTranslations("dashboard.products.form");
  const { long } = useDurationFormat();
  const [horizon, setHorizon] = useState<number | null>(null);
  const presets = useMemo(
    () => buildHorizonPresets(draft.basePeriodMinutes),
    [draft.basePeriodMinutes],
  );
  const { curve, ticks } = useHorizonCurve(draft, horizon);
  const values = curveValues(draft, draft.isProrated ? "prorated" : "whole");

  if (!draft.hasBaseRate) return null;

  return (
    <Popover>
      <PopoverTrigger
        type="button"
        className={`text-muted-foreground hover:text-foreground hover:border-foreground/20 inline-flex items-center gap-2.5 rounded-lg border px-3 py-2 text-sm transition-colors ${className ?? ""}`}
      >
        <MiniCurve
          values={values}
          className={`h-5 w-12 shrink-0 ${draft.isProrated ? "text-emerald-500" : "text-blue-500"}`}
        />
        {t("openSimulation")}
        <ChartSpline className="h-3.5 w-3.5 opacity-60" />
      </PopoverTrigger>
      <PopoverPopup
        align={align}
        className="w-[min(38rem,calc(100vw-2rem))] [--viewport-inline-padding:calc(var(--spacing)*1)]"
      >
        <div className="space-y-1.5 pt-1">
          {/* What you can do with the chart, then how far it looks. Both belong
              above it — under it they read as a caption nobody finishes. */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 ps-1.5">
            {!disabled && (
              <p className="text-muted-foreground flex items-center gap-1.5 text-xs">
                <Plus className="h-3 w-3 shrink-0" />
                {t("simulationHint")}
              </p>
            )}
            <div className="ms-auto flex gap-0.5">
              {presets.map((preset) => {
                const isActive = preset.minutes === horizon;
                const label =
                  preset.minutes === null ? t("horizonAuto") : long(preset.count, preset.unit);
                return (
                  <button
                    key={label}
                    type="button"
                    onClick={() => setHorizon(preset.minutes)}
                    aria-pressed={isActive}
                    className={`h-6 rounded-md px-2 text-xs transition-colors ${
                      isActive
                        ? "bg-accent text-foreground font-medium"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
          <InteractiveCurve
            draft={draft}
            curve={curve}
            ticks={ticks}
            currency={currency}
            disabled={disabled}
          />
        </div>
      </PopoverPopup>
    </Popover>
  );
}

function InteractiveCurve({
  draft,
  curve,
  ticks,
  currency,
  disabled,
  height = 200,
}: {
  draft: PricingDraft;
  curve: ChartDataPoint[];
  ticks: number[];
  currency: string;
  disabled: boolean;
  height?: number;
}) {
  const { short } = useDurationFormat();
  const activeKey = draft.isProrated ? "progressiveTotal" : "strictTotal";
  const shadowKey = draft.isProrated ? "strictTotal" : "progressiveTotal";
  const activeColor = draft.isProrated ? "#22c55e" : "#3b82f6";

  const handleClick = useCallback(
    (state: { activeLabel?: unknown; activePayload?: Array<{ payload?: ChartDataPoint }> }) => {
      if (disabled) return;
      const minutes =
        typeof state?.activeLabel === "number"
          ? state.activeLabel
          : state?.activePayload?.[0]?.payload?.durationMinutes;
      if (typeof minutes !== "number" || minutes <= draft.basePeriodMinutes) return;
      draft.addTier(minutes);
    },
    [disabled, draft],
  );

  const compactPrice = (value: number) =>
    formatCurrency(value, currency).replace(/[.,]00(?!\d)/, "");

  if (!draft.hasBaseRate) return null;

  return (
    <div className="w-full cursor-crosshair" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart
          data={curve}
          margin={{ top: 18, right: 4, left: 0, bottom: 0 }}
          onClick={handleClick}
        >
          <defs>
            <linearGradient id="pricing-curve-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={activeColor} stopOpacity={0.22} />
              <stop offset="95%" stopColor={activeColor} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis
            dataKey="durationMinutes"
            type="number"
            domain={["dataMin", "dataMax"]}
            ticks={ticks}
            tickFormatter={short}
            tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
            tickLine={false}
            axisLine={false}
            height={20}
          />
          <YAxis
            tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
            tickLine={false}
            axisLine={false}
            tickFormatter={compactPrice}
            width={44}
          />
          <RechartsTooltip
            cursor={{ stroke: "var(--muted-foreground)", strokeDasharray: "3 3" }}
            content={({ active, payload }) => {
              const point = payload?.[0]?.payload as ChartDataPoint | undefined;
              if (!active || !point) return null;
              return (
                <div className="bg-background rounded-lg border px-2.5 py-1.5 text-xs shadow-lg">
                  <span className="tabular-nums">{short(point.durationMinutes)}</span>
                  <span className="text-muted-foreground/50 mx-1.5">→</span>
                  <span className="font-semibold tabular-nums">
                    {formatCurrency(point[activeKey], currency)}
                  </span>
                </div>
              );
            }}
          />
          {/* The mode you did not pick stays as a ghost, so the two are comparable. */}
          <Area
            type={draft.isProrated ? "linear" : "monotone"}
            dataKey={shadowKey}
            stroke="var(--muted-foreground)"
            strokeOpacity={0.35}
            strokeWidth={1.25}
            strokeDasharray="5 3"
            fillOpacity={0}
            dot={false}
            activeDot={false}
            isAnimationActive={false}
          />
          <Area
            type={draft.isProrated ? "monotone" : "linear"}
            dataKey={activeKey}
            stroke={activeColor}
            strokeWidth={2.25}
            fill="url(#pricing-curve-fill)"
            fillOpacity={1}
            dot={false}
            activeDot={{ r: 4, fill: activeColor, stroke: "var(--background)", strokeWidth: 2 }}
            isAnimationActive={false}
          />
          {curve
            .filter((point) => point.isTierAnchor)
            .map((point) => {
              // The leftmost anchor sits against the Y axis: a centred label
              // above it spills over the price ticks, so it leans right instead.
              const isFirst = point.durationMinutes === curve[0]?.durationMinutes;
              return (
                <ReferenceDot
                  key={point.durationMinutes}
                  x={point.durationMinutes}
                  y={point[activeKey]}
                  r={4.5}
                  fill={activeColor}
                  stroke="var(--background)"
                  strokeWidth={2}
                  label={{
                    value: compactPrice(point[activeKey]),
                    position: isFirst ? "insideTopLeft" : "top",
                    offset: isFirst ? 10 : 7,
                    fontSize: 10,
                    fill: "var(--muted-foreground)",
                  }}
                />
              );
            })}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
