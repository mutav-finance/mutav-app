"use client";

import { useState } from "react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { cn } from "@/lib/utils";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

// ─── Mock data ────────────────────────────────────────────────────────────────

const PERIODS = ["7D", "30D", "90D", "1Y"] as const;
type Period = (typeof PERIODS)[number];

function isPeriod(value: string): value is Period {
  return PERIODS.some((p) => p === value);
}

const PORTFOLIO_DATA: Record<Period, { label: string; value: number }[]> = {
  "7D": [
    { label: "May 10", value: 714.2 },
    { label: "May 11", value: 717.8 },
    { label: "May 12", value: 719.4 },
    { label: "May 13", value: 721.0 },
    { label: "May 14", value: 726.3 },
    { label: "May 15", value: 730.1 },
    { label: "May 16", value: 733.7 },
  ],
  "30D": [
    { label: "Apr 17", value: 680.0 },
    { label: "Apr 22", value: 692.4 },
    { label: "Apr 27", value: 705.1 },
    { label: "May 2", value: 712.8 },
    { label: "May 7", value: 721.3 },
    { label: "May 12", value: 729.0 },
    { label: "May 16", value: 733.7 },
  ],
  "90D": [
    { label: "Feb 16", value: 420.0 },
    { label: "Mar 1", value: 512.0 },
    { label: "Mar 15", value: 558.4 },
    { label: "Apr 1", value: 601.2 },
    { label: "Apr 15", value: 641.0 },
    { label: "May 1", value: 710.8 },
    { label: "May 16", value: 733.7 },
  ],
  "1Y": [
    { label: "May '25", value: 250.0 },
    { label: "Jun '25", value: 258.1 },
    { label: "Jul '25", value: 267.4 },
    { label: "Aug '25", value: 390.2 },
    { label: "Sep '25", value: 403.8 },
    { label: "Oct '25", value: 418.5 },
    { label: "Nov '25", value: 492.1 },
    { label: "Dec '25", value: 510.3 },
    { label: "Jan '26", value: 584.7 },
    { label: "Feb '26", value: 650.2 },
    { label: "Mar '26", value: 693.4 },
    { label: "Apr '26", value: 720.1 },
    { label: "May '26", value: 733.7 },
  ],
};

type TxType = "Deposit" | "Redeem";
type TxFundId = "MTVL" | "MTVM";

const MOCK_TRANSACTIONS: {
  date: string;
  type: TxType;
  fund: TxFundId;
  amountUsd: number;
  tokens: number;
  navPrice: number;
  txHash: string;
}[] = [
  {
    date: "May 1, 2026",
    type: "Deposit",
    fund: "MTVL",
    amountUsd: 120.0,
    tokens: 116.37,
    navPrice: 1.0312,
    txHash: "a3f9c2b14e876d0f5a1c39e8b72d4f6a9c0e1b83f5d2a6714c0e9b3f12d8e76a",
  },
  {
    date: "Mar 12, 2026",
    type: "Deposit",
    fund: "MTVM",
    amountUsd: 200.0,
    tokens: 184.31,
    navPrice: 1.0852,
    txHash: "7b2e4f1d9a5c8e0b3f6a2d4c7e9b1f3a5d7c2e4b6f8a0d2c4e6b8f0a2d4c6e8",
  },
  {
    date: "Jan 14, 2026",
    type: "Deposit",
    fund: "MTVL",
    amountUsd: 150.0,
    tokens: 146.38,
    navPrice: 1.0247,
    txHash: "d5e2f8a1b4c7e0f3a6b9c2d5e8f1a4b7c0d3e6f9a2b5c8d1e4f7a0b3c6d9e2f5",
  },
  {
    date: "Nov 3, 2025",
    type: "Deposit",
    fund: "MTVL",
    amountUsd: 219.57,
    tokens: 219.57,
    navPrice: 1.0,
    txHash: "1c4f7a0d3e6b9c2f5a8d1e4b7c0f3a6d9e2b5f8a1c4e7b0d3f6a9c2e5b8f1a4",
  },
  {
    date: "Aug 20, 2025",
    type: "Deposit",
    fund: "MTVM",
    amountUsd: 35.0,
    tokens: 33.57,
    navPrice: 1.0427,
    txHash: "8f1a4d7b0e3c6f9a2d5b8e1c4f7a0d3b6e9c2f5a8d1b4e7c0f3a6d9b2e5f8a1c",
  },
  {
    date: "Jun 5, 2025",
    type: "Redeem",
    fund: "MTVL",
    amountUsd: 50.0,
    tokens: 50.0,
    navPrice: 1.0,
    txHash: "3e6b9f2a5d8c1e4b7f0a3d6e9b2c5f8a1d4e7b0c3f6a9d2e5b8c1f4a7d0e3b6c",
  },
];

const CHART_CONFIG = {
  value: {
    label: "Portfolio Value",
    color: "var(--color-chart-1)",
  },
} satisfies ChartConfig;

// ─── Portfolio Chart ──────────────────────────────────────────────────────────

function PortfolioChart() {
  const [period, setPeriod] = useState<Period>("1Y");
  const data = PORTFOLIO_DATA[period];
  const currentValue = 733.7;
  const startValue = data[0].value;
  const gain = currentValue - startValue;
  const gainPct = (gain / startValue) * 100;

  return (
    <div className="border-border bg-surface border p-5">
      <div className="mb-5 flex items-center justify-between gap-4">
        <div>
          <p className="text-text-2 text-xs tracking-wider uppercase">Portfolio Value</p>
          <div className="mt-1 flex items-baseline gap-3">
            <p className="text-text font-mono text-2xl font-semibold">${currentValue.toFixed(2)}</p>
            <span className={cn("font-mono text-sm", gain >= 0 ? "text-success" : "text-error")}>
              {gain >= 0 ? "+" : ""}
              {gain.toFixed(2)} ({gainPct.toFixed(1)}%)
            </span>
          </div>
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
      <ChartContainer config={CHART_CONFIG} className="h-[200px] w-full">
        <AreaChart data={data} margin={{ top: 4, right: 4, left: 4, bottom: 0 }}>
          <defs>
            <linearGradient id="fillPortfolio" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="var(--color-value)" stopOpacity={0.25} />
              <stop offset="95%" stopColor="var(--color-value)" stopOpacity={0} />
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
            tickFormatter={(v: number) => `$${v.toFixed(0)}`}
          />
          <ChartTooltip
            cursor={false}
            content={
              <ChartTooltipContent
                formatter={(val) => `$${Number(val).toFixed(2)}`}
                hideLabel={false}
              />
            }
          />
          <Area
            type="monotone"
            dataKey="value"
            stroke="var(--color-value)"
            strokeWidth={2}
            fill="url(#fillPortfolio)"
            dot={false}
          />
        </AreaChart>
      </ChartContainer>
    </div>
  );
}

// ─── Transaction History ──────────────────────────────────────────────────────

const STELLAR_EXPLORER_BASE = "https://stellar.expert/explorer/public/tx/";

function TxTypeBadge({ type }: { type: TxType }) {
  return (
    <span
      className={cn(
        "inline-block px-1.5 py-0.5 font-mono text-xs",
        type === "Deposit" ? "bg-success/15 text-success" : "bg-text-3/15 text-text-3",
      )}
    >
      {type}
    </span>
  );
}

function TruncatedHash({ hash }: { hash: string }) {
  return (
    <a
      href={`${STELLAR_EXPLORER_BASE}${hash}`}
      target="_blank"
      rel="noopener noreferrer"
      className="text-accent font-mono text-xs underline-offset-2 hover:underline"
      title={hash}
    >
      {hash.slice(0, 8)}…{hash.slice(-6)}
    </a>
  );
}

function HistoryTable() {
  return (
    <div className="border-border bg-surface border">
      <div className="border-border border-b px-5 py-3">
        <p className="text-text-2 text-xs tracking-wider uppercase">Transaction History</p>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-border border-b">
            <th className="text-text-3 px-5 py-3 text-left font-mono text-xs tracking-wider uppercase">
              Date
            </th>
            <th className="text-text-3 px-5 py-3 text-left font-mono text-xs tracking-wider uppercase">
              Type
            </th>
            <th className="text-text-3 px-5 py-3 text-left font-mono text-xs tracking-wider uppercase">
              Fund
            </th>
            <th className="text-text-3 px-5 py-3 text-right font-mono text-xs tracking-wider uppercase">
              Amount (USD)
            </th>
            <th className="text-text-3 px-5 py-3 text-right font-mono text-xs tracking-wider uppercase">
              Tokens
            </th>
            <th className="text-text-3 px-5 py-3 text-right font-mono text-xs tracking-wider uppercase">
              NAV
            </th>
            <th className="text-text-3 px-5 py-3 text-right font-mono text-xs tracking-wider uppercase">
              Tx Hash
            </th>
          </tr>
        </thead>
        <tbody>
          {MOCK_TRANSACTIONS.map((tx, i) => (
            <tr
              key={tx.txHash}
              className={cn(
                "hover:bg-surface-2 transition-colors",
                i < MOCK_TRANSACTIONS.length - 1 && "border-border border-b",
              )}
            >
              <td className="text-text-2 px-5 py-3">{tx.date}</td>
              <td className="px-5 py-3">
                <TxTypeBadge type={tx.type} />
              </td>
              <td className="text-text px-5 py-3 font-mono">{tx.fund}</td>
              <td className="text-text px-5 py-3 text-right font-mono">
                ${tx.amountUsd.toFixed(2)}
              </td>
              <td className="text-text px-5 py-3 text-right font-mono">{tx.tokens.toFixed(2)}</td>
              <td className="text-text-2 px-5 py-3 text-right font-mono">
                ${tx.navPrice.toFixed(4)}
              </td>
              <td className="px-5 py-3 text-right">
                <TruncatedHash hash={tx.txHash} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Export ───────────────────────────────────────────────────────────────────

export function PortfolioSection() {
  return (
    <>
      <PortfolioChart />
      <HistoryTable />
    </>
  );
}
