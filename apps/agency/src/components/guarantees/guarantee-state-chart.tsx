"use client";

import { TrendingUpIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { GUARANTEE_EVENTS } from "@convex/guarantees/domain";
import type {
  ActivityGranularity,
  GuaranteeEvent,
  GuaranteeState,
  StateTimelineBucket,
} from "@convex/guarantees/domain";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@mutav/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@mutav/ui/chart";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@mutav/ui/select";
import { Skeleton } from "@mutav/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@mutav/ui/toggle-group";
import {
  CHART_FILL_OPACITY,
  GUARANTEE_EVENT_CHART_COLOR,
  GUARANTEE_STATE_CHART_COLOR,
} from "@/components/guarantees/state-chart-palette";
import {
  useGuaranteeStateChart,
  type GuaranteeStateChartRangeOption,
} from "@/components/guarantees/use-guarantee-state-chart";
import {
  GUARANTEE_STATE_STACK_ORDER,
  SHARED_X_AXIS_SCALE,
  type GuaranteeStateCounts,
  type GuaranteeStateLegendEntry,
} from "@/lib/guarantees/state-chart";

export type { GuaranteeStateChartRangeOption };

type GuaranteeStateChartProps = {
  timeline: StateTimelineBucket[] | null | undefined;
  counts: GuaranteeStateCounts | null | undefined;
  granularity: ActivityGranularity;
  rangeOptions: readonly GuaranteeStateChartRangeOption[];
  defaultRange: string;
  i18nNamespace: string;
  showTrendIcon?: boolean;
  showEventPanel?: boolean;
};

const CHART_STACK_ID = "book";
const AXIS_WIDTH = 32;
// Wide enough that a single event is a bar rather than a speck. At six months
// each category is ~175px, so five series fit comfortably; at twelve the cap
// stops binding and the category gap does the work.
const EVENT_BAR_MAX_WIDTH_PX = 18;
// Both plots must start their drawing area at the same x, or the shared time
// axis lies. Identical y-axis width plus identical margins is what guarantees
// it — Recharts has no cross-chart alignment primitive.
const SHARED_MARGIN = { top: 4, right: 12, bottom: 0, left: 12 };

/**
 * The guarantee book in one card, split by the two questions it answers.
 *
 * **Top panel — composition (a stock).** The five in-force states stacked, so
 * the silhouette IS the book under management and its height rises and falls
 * with the carteira. Interpolation is `linear` rather than a spline so no band
 * is ever drawn above or below a count that was actually observed.
 *
 * **Bottom panel — events (a flow).** How many guarantees were created,
 * activated, defaulted, paid out and closed in each period. It shares the top
 * panel's x-axis but never its plot: events and book size are different units,
 * and overlaying them is what forced the second y-axis this card used to
 * carry. A handful of events against hundreds in force either vanishes or
 * distorts the scale — beneath, on its own scale, it does neither.
 */
export function GuaranteeStateChart({
  timeline,
  counts,
  granularity,
  rangeOptions,
  defaultRange,
  i18nNamespace,
  showTrendIcon = false,
  showEventPanel = false,
}: GuaranteeStateChartProps) {
  const t = useTranslations(i18nNamespace);
  const chart = useGuaranteeStateChart({
    timeline,
    counts,
    granularity,
    rangeOptions,
    defaultRange,
  });

  return (
    <Card className="@container/card">
      <CardHeader>
        {showTrendIcon ? (
          <CardDescription className="flex items-center gap-1.5">
            <TrendingUpIcon className="size-3.5" />
            {t("descriptionLong")}
          </CardDescription>
        ) : (
          <CardDescription>
            <span className="hidden @[540px]/card:block">{t("descriptionLong")}</span>
            <span className="@[540px]/card:hidden">{t("descriptionShort")}</span>
          </CardDescription>
        )}
        <CardTitle>{t("title")}</CardTitle>
        <CardAction>
          <ToggleGroup
            type="single"
            value={chart.range}
            onValueChange={(value) => value && chart.setRange(value)}
            variant="outline"
            className="hidden *:data-[slot=toggle-group-item]:px-4! @[767px]/card:flex"
          >
            {rangeOptions.map((option) => (
              <ToggleGroupItem key={option.value} value={option.value}>
                {t(option.labelKey)}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <Select value={chart.range} onValueChange={(value) => chart.setRange(value)}>
            <SelectTrigger
              className="flex w-40 **:data-[slot=select-value]:block **:data-[slot=select-value]:truncate @[767px]/card:hidden"
              size="sm"
              aria-label={t("selectRangeAriaLabel")}
            >
              <SelectValue
                placeholder={chart.activeOption ? t(chart.activeOption.labelKey) : undefined}
              />
            </SelectTrigger>
            <SelectContent className="rounded-xl">
              {rangeOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {t(option.labelKey)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 px-2 pt-4 sm:px-6 sm:pt-6">
        {chart.isLoading ? (
          <Skeleton className="h-[220px] w-full" />
        ) : (
          <ChartContainer config={chart.compositionConfig} className="aspect-auto h-[220px] w-full">
            <AreaChart data={[...chart.compositionRows]} margin={SHARED_MARGIN}>
              <CartesianGrid vertical={false} />
              {/* One time axis for both panels: when the event panel is below,
                  it owns the ticks and this one only supplies the scale. */}
              <XAxis
                dataKey="period"
                hide={showEventPanel}
                scale={SHARED_X_AXIS_SCALE}
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                tickFormatter={chart.tickFormatter}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                allowDecimals={false}
                domain={[0, chart.compositionAxisMax]}
                width={AXIS_WIDTH}
              />
              <ChartTooltip
                cursor={false}
                content={
                  <ChartTooltipContent labelFormatter={chart.labelFormatter} indicator="dot" />
                }
              />
              {GUARANTEE_STATE_STACK_ORDER.map((state) => (
                <Area
                  key={state}
                  dataKey={state}
                  stackId={CHART_STACK_ID}
                  type="natural"
                  fill={`var(--color-${state})`}
                  fillOpacity={CHART_FILL_OPACITY}
                  stroke={`var(--color-${state})`}
                  dot={false}
                />
              ))}
            </AreaChart>
          </ChartContainer>
        )}

        {showEventPanel ? (
          <EventPanel title={t("eventsTitle")} emptyLabel={t("eventsEmpty")} chart={chart} />
        ) : null}

        <StateLegend
          entries={chart.legend}
          contextEntries={chart.contextFigures}
          label={t("legendLabel")}
          labelFor={chart.stateLabel}
        />
      </CardContent>
    </Card>
  );
}

function EventPanel({
  title,
  emptyLabel,
  chart,
}: {
  title: string;
  emptyLabel: string;
  chart: ReturnType<typeof useGuaranteeStateChart>;
}) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-muted-foreground px-2 text-xs sm:px-0">{title}</p>
      {chart.isLoading ? (
        <Skeleton className="h-[96px] w-full" />
      ) : chart.hasEvents ? (
        <ChartContainer config={chart.eventConfig} className="aspect-auto h-[96px] w-full">
          <BarChart
            data={[...chart.eventRows]}
            margin={SHARED_MARGIN}
            barGap={1}
            barCategoryGap="12%"
          >
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="period"
              scale={SHARED_X_AXIS_SCALE}
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              tickFormatter={chart.tickFormatter}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              allowDecimals={false}
              domain={[0, chart.eventAxisMax]}
              tickCount={chart.eventTickCount}
              width={AXIS_WIDTH}
            />
            <ChartTooltip
              cursor={false}
              content={
                <ChartTooltipContent labelFormatter={chart.labelFormatter} indicator="dot" />
              }
            />
            {GUARANTEE_EVENTS.map((event) => (
              <Bar
                key={event}
                dataKey={event}
                fill={`var(--color-${event})`}
                fillOpacity={CHART_FILL_OPACITY}
                maxBarSize={EVENT_BAR_MAX_WIDTH_PX}
              />
            ))}
          </BarChart>
        </ChartContainer>
      ) : (
        <p className="text-muted-foreground px-2 text-xs sm:px-0">{emptyLabel}</p>
      )}
      <EventLegend labelFor={chart.eventLabel} />
    </div>
  );
}

function EventLegend({ labelFor }: { labelFor: (event: GuaranteeEvent) => string }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 px-2 sm:px-0">
      {GUARANTEE_EVENTS.map((event) => (
        <li key={event} className="text-muted-foreground flex h-5 items-center gap-1.5 text-xs">
          <Swatch color={GUARANTEE_EVENT_CHART_COLOR[event]} />
          {labelFor(event)}
        </li>
      ))}
    </ul>
  );
}

/**
 * Full strength, always. The plotted fill is a 0.4 wash — atmospheric, not the
 * identity channel — so the swatch is where the validated ramp step is shown
 * at the value it was validated at.
 */
function Swatch({ color }: { color: string }) {
  return (
    <span
      aria-hidden
      className="size-2.5 shrink-0 rounded-[2px]"
      style={{ backgroundColor: color }}
    />
  );
}

/**
 * One row per band: swatch, label and count on a single baseline. The count is
 * a supporting figure, not a hero — a view gets exactly one hero figure, and
 * five competing 24px numbers on a ragged baseline is what the oversized draft
 * produced. Text stays in text tokens; the swatch carries the identity.
 */
function StateLegend({
  entries,
  contextEntries,
  label,
  labelFor,
}: {
  entries: GuaranteeStateLegendEntry[] | null;
  contextEntries: GuaranteeStateLegendEntry[] | null;
  label: string;
  labelFor: (state: GuaranteeState) => string;
}) {
  return (
    <div className="flex flex-col gap-2 px-2 sm:px-0">
      {/* Cells size to their content and sit in a wrapping row. A fixed grid
          stretched each cell to a full column and flushed the count to the far
          edge, where it read as belonging to nothing. */}
      <dl aria-label={label} className="flex flex-wrap gap-x-6 gap-y-1">
        {GUARANTEE_STATE_STACK_ORDER.map((state) => {
          const count = entries?.find((entry) => entry.state === state)?.count;
          return (
            <div key={state} className="flex h-6 items-center gap-1.5">
              <Swatch color={GUARANTEE_STATE_CHART_COLOR[state]} />
              <dt className="text-muted-foreground text-xs">{labelFor(state)}</dt>
              <dd className="text-foreground text-sm font-semibold tabular-nums">
                {count === undefined ? <Skeleton className="h-4 w-6" /> : count}
              </dd>
            </div>
          );
        })}
      </dl>
      <dl className="text-muted-foreground flex flex-wrap gap-x-4 text-xs">
        {(contextEntries ?? []).map(({ state, count }) => (
          <div key={state} className="flex h-5 items-center gap-1.5">
            <dt>{labelFor(state)}</dt>
            <dd className="tabular-nums">{count}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
