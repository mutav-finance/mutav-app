import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { RISK_COLOR } from "./fund-data";
import type { Fund } from "./fund-data";

const RISK_LABEL: Record<Fund["risk"], string> = {
  low: "Low Risk",
  medium: "Med Risk",
  high: "High Risk",
};

function formatUsd(value: number): string {
  if (value >= 1_000_000) {
    return `$${(value / 1_000_000).toFixed(1)}M`;
  }
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-text-2 text-xs tracking-wider uppercase">{label}</span>
      <span className="text-text font-mono text-lg">{value}</span>
    </div>
  );
}

export function FundCard({ fund }: { fund: Fund }) {
  return (
    <article className="border-border bg-surface flex flex-col gap-6 border p-6">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className={`size-2 shrink-0 ${RISK_COLOR[fund.risk]}`} aria-hidden />
            <span className="text-text-2 font-mono text-xs tracking-widest uppercase">
              {fund.id}
            </span>
          </div>
          <p className="text-text text-lg font-semibold">{fund.name}</p>
          <p className="text-text-2 text-sm">{fund.description}</p>
        </div>
        <span className="border-border text-text-3 shrink-0 border px-2 py-0.5 font-mono text-xs">
          {RISK_LABEL[fund.risk]}
        </span>
      </div>

      <div className="border-border flex flex-col gap-1 border-t pt-4">
        <span className="text-text-2 text-xs tracking-wider uppercase">APY</span>
        <span className="text-accent font-mono text-3xl font-semibold">{fund.apy.toFixed(1)}%</span>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Stat label="AUM" value={formatUsd(fund.aumUsd)} />
        <Stat label="NAV Price" value={`$${fund.navPrice.toFixed(4)}`} />
        <Stat label="Contracts" value={fund.contractsCovered.toLocaleString("en-US")} />
      </div>

      <Button asChild className="w-full" size="lg">
        <Link href={`/investor/deposit?fund=${fund.id}`}>Deposit {fund.id}</Link>
      </Button>
    </article>
  );
}
