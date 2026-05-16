import { cn } from "@/lib/utils";
import type { PROTOCOL_STATS } from "./fund-data";

type ProtocolStats = typeof PROTOCOL_STATS;
type Variant = "wide" | "narrow";

function formatUsd(value: number): string {
  if (value >= 1_000_000) {
    return `$${(value / 1_000_000).toFixed(1)}M`;
  }
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

function KpiCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 px-6 py-4">
      <span className="text-text-2 text-xs tracking-wider uppercase">{label}</span>
      <span className="text-text font-mono text-xl font-semibold">{value}</span>
    </div>
  );
}

export function ProtocolKpiStrip({
  stats,
  variant = "wide",
  showTrustedBy = false,
}: {
  stats: ProtocolStats;
  variant?: Variant;
  showTrustedBy?: boolean;
}) {
  return (
    <div className="border-border border-b">
      <div
        className={cn(
          "mx-auto flex w-full items-center",
          variant === "narrow"
            ? "max-w-(--page-content-max-width)"
            : "max-w-(--page-wide-max-width)",
        )}
      >
        <KpiCell label="Total AUM" value={formatUsd(stats.totalAumUsd)} />
        <div className="bg-border w-px shrink-0 self-stretch" />
        <KpiCell
          label="APY Range"
          value={`${stats.minApy.toFixed(1)}% — ${stats.maxApy.toFixed(1)}%`}
        />
        <div className="bg-border w-px shrink-0 self-stretch" />
        <KpiCell label="Contracts Covered" value={stats.totalContracts.toLocaleString("en-US")} />
        {showTrustedBy && (
          <div className="ml-auto flex items-center gap-4 px-6">
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
        )}
      </div>
    </div>
  );
}
