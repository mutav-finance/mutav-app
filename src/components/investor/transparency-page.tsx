"use client";

import { useState } from "react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { cn } from "@/lib/utils";
import { PageShell } from "@/components/page/page-shell";
import { PageContent } from "@/components/page/page-content";
import { PageHeader } from "@/components/page/page-header";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

// ─── Mock data ────────────────────────────────────────────────────────────────

const TRANSPARENCY_STATS = [
  { label: "Guarantee Volume / yr", value: "$47.2M" },
  { label: "Active Contracts", value: "2,210" },
  { label: "Partner Agencies", value: "34" },
  { label: "Default Rate", value: "3.8%" },
] as const;

const PERIODS = ["7D", "30D", "90D", "1Y"] as const;
type Period = (typeof PERIODS)[number];

function isPeriod(value: string): value is Period {
  return PERIODS.some((p) => p === value);
}

const AUM_DATA: Record<Period, { label: string; aum: number }[]> = {
  "7D": [
    { label: "May 10", aum: 154_200_000 },
    { label: "May 11", aum: 155_100_000 },
    { label: "May 12", aum: 156_300_000 },
    { label: "May 13", aum: 157_000_000 },
    { label: "May 14", aum: 157_800_000 },
    { label: "May 15", aum: 158_400_000 },
    { label: "May 16", aum: 159_000_000 },
  ],
  "30D": [
    { label: "Apr 17", aum: 141_000_000 },
    { label: "Apr 22", aum: 144_500_000 },
    { label: "Apr 27", aum: 148_200_000 },
    { label: "May 2", aum: 151_800_000 },
    { label: "May 7", aum: 155_100_000 },
    { label: "May 12", aum: 157_300_000 },
    { label: "May 16", aum: 159_000_000 },
  ],
  "90D": [
    { label: "Feb 16", aum: 98_000_000 },
    { label: "Mar 1", aum: 109_000_000 },
    { label: "Mar 15", aum: 119_000_000 },
    { label: "Apr 1", aum: 130_000_000 },
    { label: "Apr 15", aum: 140_000_000 },
    { label: "May 1", aum: 151_000_000 },
    { label: "May 16", aum: 159_000_000 },
  ],
  "1Y": [
    { label: "May '25", aum: 78_000_000 },
    { label: "Jun '25", aum: 88_000_000 },
    { label: "Jul '25", aum: 99_000_000 },
    { label: "Aug '25", aum: 108_000_000 },
    { label: "Sep '25", aum: 116_000_000 },
    { label: "Oct '25", aum: 124_000_000 },
    { label: "Nov '25", aum: 133_000_000 },
    { label: "Dec '25", aum: 140_000_000 },
    { label: "Jan '26", aum: 147_000_000 },
    { label: "Feb '26", aum: 151_000_000 },
    { label: "Mar '26", aum: 155_000_000 },
    { label: "Apr '26", aum: 159_000_000 },
  ],
};

const AGENCIES = [
  { name: "Imobiliária Alfa", contracts: 312, volumeUsd: 8_400_000, defaultRate: 0.3 },
  { name: "Casa & Cia", contracts: 287, volumeUsd: 7_100_000, defaultRate: 0.7 },
  { name: "Prime Imóveis", contracts: 201, volumeUsd: 5_800_000, defaultRate: 1.1 },
  { name: "Grupo Residencial", contracts: 183, volumeUsd: 5_200_000, defaultRate: 1.4 },
  { name: "Metro Aluguéis", contracts: 156, volumeUsd: 4_100_000, defaultRate: 0.5 },
  { name: "SP Gestão", contracts: 134, volumeUsd: 3_700_000, defaultRate: 1.8 },
  { name: "RJ Properties", contracts: 98, volumeUsd: 2_900_000, defaultRate: 0.8 },
  { name: "Sul Imóveis", contracts: 76, volumeUsd: 2_100_000, defaultRate: 2.4 },
] as const;

const CHART_CONFIG = {
  aum: {
    label: "AUM",
    color: "var(--color-chart-1)",
  },
} satisfies ChartConfig;

// ─── Sub-components ───────────────────────────────────────────────────────────

function TransparencyStatsStrip() {
  return (
    <div className="border-border border-b">
      <div className="mx-auto flex w-full max-w-(--page-wide-max-width) items-center px-4 lg:px-6">
        {TRANSPARENCY_STATS.map((stat, i) => (
          <div
            key={stat.label}
            className={cn(
              "flex flex-col gap-1 py-4 pr-10",
              i > 0 && "pl-10",
              i < TRANSPARENCY_STATS.length - 1 && "border-border border-r",
            )}
          >
            <span className="text-text-2 text-xs tracking-wider uppercase">{stat.label}</span>
            <span className="text-text font-mono text-xl font-semibold">{stat.value}</span>
          </div>
        ))}
        <div className="ml-auto flex items-center gap-4">
          <span className="text-text-3 text-xs tracking-wider uppercase">Trusted by</span>
          <div className="flex items-center gap-2">
            <div className="border-border border px-3 py-1.5 opacity-40">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/stellar-logo.png" alt="Stellar" className="h-4 w-auto" />
            </div>
            <div className="border-border border px-3 py-1.5 opacity-40">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/nearx-logo.png" alt="NearX" className="h-4 w-auto" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function AumChart() {
  const [period, setPeriod] = useState<Period>("1Y");
  const data = AUM_DATA[period];

  return (
    <div className="border-border bg-surface border p-5">
      <div className="mb-5 flex items-center justify-between gap-4">
        <div>
          <p className="text-text-2 text-xs tracking-wider uppercase">Assets Under Management</p>
          <p className="text-text mt-1 font-mono text-2xl font-semibold">$159M</p>
        </div>
        <ToggleGroup
          type="single"
          value={period}
          onValueChange={(v) => {
            if (isPeriod(v)) setPeriod(v);
          }}
          variant="outline"
          spacing={0}
        >
          {PERIODS.map((p) => (
            <ToggleGroupItem
              key={p}
              value={p}
              className="text-text-2 data-[state=on]:text-accent font-mono text-xs"
            >
              {p}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
      <ChartContainer config={CHART_CONFIG} className="h-[240px] w-full">
        <AreaChart data={data} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
          <defs>
            <linearGradient id="fillAum" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="var(--color-aum)" stopOpacity={0.25} />
              <stop offset="95%" stopColor="var(--color-aum)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} strokeDasharray="3 3" />
          <XAxis
            dataKey="label"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            tick={{ fontSize: 11 }}
          />
          <YAxis
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            tick={{ fontSize: 11 }}
            width={52}
            tickFormatter={(v: number) => `$${(v / 1_000_000).toFixed(0)}M`}
          />
          <ChartTooltip
            cursor={false}
            content={
              <ChartTooltipContent
                formatter={(value) => `$${(Number(value) / 1_000_000).toFixed(1)}M`}
                hideLabel={false}
              />
            }
          />
          <Area
            type="monotone"
            dataKey="aum"
            stroke="var(--color-aum)"
            strokeWidth={2}
            fill="url(#fillAum)"
            dot={false}
          />
        </AreaChart>
      </ChartContainer>
    </div>
  );
}

// < 1% → great (green) · 1–1.5% → normal (neutral) · > 1.5% → risk (red)
function defaultRateColor(rate: number): string {
  if (rate < 1.0) return "text-success";
  if (rate <= 1.5) return "text-text";
  return "text-error";
}

function AgencyTable() {
  return (
    <div className="border-border bg-surface border">
      <div className="border-border border-b px-5 py-3">
        <p className="text-text-2 text-xs tracking-wider uppercase">Partner Agencies</p>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-border border-b">
            <th className="text-text-3 px-5 py-3 text-left font-mono text-xs tracking-wider uppercase">
              Agency
            </th>
            <th className="text-text-3 px-5 py-3 text-right font-mono text-xs tracking-wider uppercase">
              Contracts
            </th>
            <th className="text-text-3 px-5 py-3 text-right font-mono text-xs tracking-wider uppercase">
              Volume
            </th>
            <th className="text-text-3 px-5 py-3 text-right font-mono text-xs tracking-wider uppercase">
              Default Rate
            </th>
          </tr>
        </thead>
        <tbody>
          {AGENCIES.map((agency, i) => (
            <tr
              key={agency.name}
              className={cn(
                "hover:bg-surface-2 transition-colors",
                i < AGENCIES.length - 1 && "border-border border-b",
              )}
            >
              <td className="text-text px-5 py-3">{agency.name}</td>
              <td className="text-text px-5 py-3 text-right font-mono">
                {agency.contracts.toLocaleString("en-US")}
              </td>
              <td className="text-text px-5 py-3 text-right font-mono">
                ${(agency.volumeUsd / 1_000_000).toFixed(1)}M
              </td>
              <td
                className={cn(
                  "px-5 py-3 text-right font-mono",
                  defaultRateColor(agency.defaultRate),
                )}
              >
                {agency.defaultRate.toFixed(1)}%
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function LastUpdated() {
  return (
    <div className="flex items-center gap-2">
      <span className="bg-success tga-live-square size-1.5" aria-hidden />
      <span className="text-text-3 font-mono text-xs">Last updated May 16, 2026 · 14:23 UTC</span>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export function TransparencyPage() {
  return (
    <div className="flex flex-1 flex-col">
      <TransparencyStatsStrip />
      <PageShell>
        <PageHeader
          width="wide"
          title="Transparency Layer"
          subtitle="MUTAV replaces concentrated guarantee capital with distributed fund pools — giving investors, agencies, and tenants shared access to a market that was structurally closed. Every contract and fund movement is registered on Stellar and verifiable by all participants."
        />
        <PageContent variant="wide">
          <AumChart />
          <AgencyTable />
          <LastUpdated />
        </PageContent>
      </PageShell>
    </div>
  );
}
