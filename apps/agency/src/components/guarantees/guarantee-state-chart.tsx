"use client";

import { TrendingUpIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Area, Bar, CartesianGrid, ComposedChart, XAxis, YAxis } from "recharts";
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
  AREA_FILL_OPACITY,
  AREA_STROKE_WIDTH,
  EVENT_BAR_RADIUS,
  GUARANTEE_EVENT_CHART_COLOR,
  GUARANTEE_STATE_SWATCH_COLOR,
} from "@/components/guarantees/state-chart-palette";
import {
  useGuaranteeStateChart,
  type GuaranteeStateChartRangeOption,
} from "@/components/guarantees/use-guarantee-state-chart";
import {
  GUARANTEE_IN_FORCE_STATES,
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
  showEvents?: boolean;
  /**
   * Off where a per-state count row already exists on the page. The agency
   * dashboard's lifecycle pipeline carries those counts on the machine's own
   * topology directly above this card; repeating them here would be the same
   * seven numbers twice. The transparency page has no pipeline, so the row
   * stays its only per-state granularity.
   */
  showStateCounts?: boolean;
};

const AXIS_WIDTH = 32;
// Wide enough that a single event is a bar rather than a speck. At six months
// each category is ~175px, so five series fit comfortably; at twelve the cap
// stops binding and the category gap does the work.
const EVENT_BAR_MAX_WIDTH_PX = 18;
const CHART_MARGIN = { top: 4, right: 12, bottom: 0, left: 12 };

/**
 * The guarantee book in one card: one plot, one count row.
 *
 * The **area** is the book in force — how many guarantees Mutav was on risk
 * for at the end of each period — in the brand accent, as a wash under a 2px
 * stroke. One series, because that total is the line an agency tracks; five
 * stacked bands of one hue turned it into a mass and cost the reader the
 * shape. Drafts and closed guarantees stay out, so the line can fall as well
 * as rise. `monotone`, never `natural`: a spline through integer counts
 * overshoots between sharp steps and draws the book at values never observed.
 *
 * The **bars** are that period's lifecycle events, in semantic colour: green
 * is the business working, red is money leaving, grey has no valence. They sit
 * on the SAME y axis as the area — no `yAxisId`, one `<YAxis>`. Two
 * independently scaled axes would let a single event paint as tall as a
 * quarter of a two-hundred-guarantee book, silently, as volume grows. Short
 * bars against a tall area are the honest picture; exact counts come from the
 * tooltip.
 *
 * The **count row** carries the per-state granularity, with the same swatch
 * the status tags in the table below use. It is opt-out: a page that already
 * shows those seven numbers turns it off (`showStateCounts`).
 */
export function GuaranteeStateChart({
  timeline,
  counts,
  granularity,
  rangeOptions,
  defaultRange,
  i18nNamespace,
  showTrendIcon = false,
  showEvents = false,
  showStateCounts = true,
}: GuaranteeStateChartProps) {
  const t = useTranslations(i18nNamespace);
  const chart = useGuaranteeStateChart({
    timeline,
    counts,
    inForceLabel: t("inForceLabel"),
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
          <Skeleton className="h-[250px] w-full" />
        ) : (
          <ChartContainer config={chart.chartConfig} className="aspect-auto h-[250px] w-full">
            <ComposedChart
              data={[...chart.chartRows]}
              margin={CHART_MARGIN}
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
                domain={[0, chart.axisMax]}
                width={AXIS_WIDTH}
              />
              <ChartTooltip
                cursor={false}
                content={
                  <ChartTooltipContent labelFormatter={chart.labelFormatter} indicator="dot" />
                }
              />
              {showEvents
                ? GUARANTEE_EVENTS.map((event) => (
                    <Bar
                      key={event}
                      dataKey={event}
                      fill={`var(--color-${event})`}
                      radius={EVENT_BAR_RADIUS}
                      maxBarSize={EVENT_BAR_MAX_WIDTH_PX}
                    />
                  ))
                : null}
              <Area
                dataKey="inForce"
                type="monotone"
                fill="var(--color-inForce)"
                fillOpacity={AREA_FILL_OPACITY}
                stroke="var(--color-inForce)"
                strokeWidth={AREA_STROKE_WIDTH}
                dot={false}
              />
            </ComposedChart>
          </ChartContainer>
        )}

        {showEvents ? <EventLegend label={t("eventsTitle")} labelFor={chart.eventLabel} /> : null}

        {showStateCounts ? (
          <StateLegend
            entries={chart.legend}
            contextEntries={chart.contextFigures}
            label={t("legendLabel")}
            labelFor={chart.stateLabel}
          />
        ) : null}
      </CardContent>
    </Card>
  );
}

function EventLegend({
  label,
  labelFor,
}: {
  label: string;
  labelFor: (event: GuaranteeEvent) => string;
}) {
  return (
    <ul aria-label={label} className="flex flex-wrap gap-x-4 gap-y-1 px-2 sm:px-0">
      {GUARANTEE_EVENTS.map((event) => (
        <li key={event} className="text-muted-foreground flex h-5 items-center gap-1.5 text-xs">
          <Swatch color={GUARANTEE_EVENT_CHART_COLOR[event]} />
          {labelFor(event)}
        </li>
      ))}
    </ul>
  );
}

/** The status tag's dot, at the size a legend wants. */
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
 * One row per in-force state: swatch, label and count on a single baseline.
 * This is where the card's granularity lives now that the plot carries one
 * series. The count is a supporting figure, not a hero — a view gets exactly
 * one hero figure, and five competing 24px numbers on a ragged baseline is
 * what the oversized draft produced. Text stays in text tokens; the swatch
 * carries the identity, and it is the same swatch the status tags use.
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
        {GUARANTEE_IN_FORCE_STATES.map((state) => {
          const count = entries?.find((entry) => entry.state === state)?.count;
          return (
            <div key={state} className="flex h-6 items-center gap-1.5">
              <Swatch color={GUARANTEE_STATE_SWATCH_COLOR[state]} />
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
