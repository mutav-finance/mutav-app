"use client";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { PageShell } from "@/components/page/page-shell";
import { PageContent } from "@/components/page/page-content";
import { ProtocolKpiStrip } from "./protocol-kpi-strip";
import { useDepositWidget } from "./use-deposit-widget";
import { isAssetSymbol } from "@/lib/stellar/assets";
import { FUNDS, RISK_COLOR, PROTOCOL_STATS, isFundId } from "./fund-data";
import type { FundId } from "./fund-data";

const FUND_RISK_LABEL: Record<FundId, string> = {
  MTVL: "Low Risk",
  MTVM: "Med Risk",
  MTVH: "High Risk",
};

// Non-interactive showcase of all available funds
function FundShowcase() {
  return (
    <div>
      <p className="text-text-3 mb-2 text-xs tracking-wider uppercase">Available Funds</p>
      <div className="border-border flex border">
        {FUNDS.map((fund, i) => (
          <div
            key={fund.id}
            className={cn(
              "flex flex-1 flex-col gap-1 px-4 py-3",
              i < FUNDS.length - 1 && "border-border border-r",
            )}
          >
            <div className="flex items-center gap-1.5">
              <span className={`size-1.5 shrink-0 ${RISK_COLOR[fund.risk]}`} aria-hidden />
              <span className="text-text-2 font-mono text-xs tracking-wider">{fund.id}</span>
            </div>
            <span className="text-accent font-mono text-base font-semibold">
              {fund.apy.toFixed(1)}%
            </span>
            <span className="text-text-3 text-xs">{FUND_RISK_LABEL[fund.id]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function SwapDivider() {
  return (
    <div className="border-border relative border-t">
      <span className="bg-surface text-text-3 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 px-3 font-mono text-xs">
        ↓
      </span>
    </div>
  );
}

export function DepositPage({ initialFund }: { initialFund: string | undefined }) {
  const validFundId = (
    initialFund === "MTVL" || initialFund === "MTVM" || initialFund === "MTVH"
      ? initialFund
      : "MTVL"
  ) satisfies FundId;

  const w = useDepositWidget(validFundId);

  return (
    <div className="flex flex-1 flex-col">
      <ProtocolKpiStrip stats={PROTOCOL_STATS} variant="narrow" />
      <PageShell>
        <PageContent variant="narrow">
          <FundShowcase />

          {/* Swap card */}
          <div className="border-border bg-surface border">
            {/* YOU PAY */}
            <div className="p-5">
              <span className="text-text-2 text-xs tracking-wider uppercase">You Pay</span>
              <div className="mt-3 flex items-center gap-3">
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder="0"
                  value={w.rawAmount}
                  onChange={(e) => w.setRawAmount(e.target.value)}
                  aria-label="Amount to pay"
                  className="text-text placeholder:text-text-3 min-w-0 flex-1 bg-transparent font-mono text-3xl outline-none"
                />
                <Select
                  value={w.inputToken}
                  onValueChange={(v) => {
                    if (isAssetSymbol(v)) w.setInputToken(v);
                  }}
                >
                  {/* Custom children — avoids Radix SelectValue empty-on-mount issue */}
                  <SelectTrigger className="border-border h-9 w-auto shrink-0">
                    <span className="text-text font-mono text-sm">{w.inputToken}</span>
                  </SelectTrigger>
                  {/* position=popper anchors below trigger; item-aligned breaks with overflow-y-auto ancestors */}
                  <SelectContent className="dark" position="popper">
                    <SelectItem value="XLM">XLM</SelectItem>
                    <SelectItem value="USDC">USDC</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <span className="text-text-2 mt-2 block font-mono text-sm">
                {w.amount > 0 ? `≈ $${w.inputUsd.toFixed(2)} USD` : " "}
              </span>
            </div>

            <SwapDivider />

            {/* YOU RECEIVE */}
            <div className="p-5">
              <span className="text-text-2 text-xs tracking-wider uppercase">You Receive</span>
              <div className="mt-3 flex items-center gap-3">
                <span className="text-text flex-1 font-mono text-3xl">
                  {w.amount > 0 ? w.outputAmount.toFixed(4) : "0"}
                </span>
                <Select
                  value={w.selectedFund}
                  onValueChange={(v) => {
                    if (isFundId(v)) w.setSelectedFund(v);
                  }}
                >
                  {/* Custom children — avoids Radix SelectValue empty-on-mount issue */}
                  <SelectTrigger className="border-border h-9 w-auto shrink-0">
                    <div className="flex items-center gap-2">
                      <span
                        className={`size-1.5 shrink-0 ${RISK_COLOR[w.fund.risk]}`}
                        aria-hidden
                      />
                      <span className="text-text font-mono text-sm">{w.selectedFund}</span>
                    </div>
                  </SelectTrigger>
                  {/* position=popper anchors below trigger; item-aligned breaks with overflow-y-auto ancestors */}
                  <SelectContent className="dark" position="popper">
                    {FUNDS.map((fund) => (
                      <SelectItem key={fund.id} value={fund.id}>
                        <div className="flex items-center gap-2">
                          <span
                            className={`size-1.5 shrink-0 ${RISK_COLOR[fund.risk]}`}
                            aria-hidden
                          />
                          {fund.id}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <span className="text-text-2 mt-2 block font-mono text-sm">
                {w.fund.name} · NAV ${w.fund.navPrice.toFixed(4)}
              </span>
            </div>

            {/* Rate + fee — only shown when an amount is entered */}
            {w.amount > 0 && (
              <div className="border-border flex items-center justify-between border-t px-5 py-3">
                <span className="text-text-2 font-mono text-xs">
                  1 {w.inputToken} ≈ {w.ratePerInputToken.toFixed(4)} {w.fund.id}
                </span>
                <span className="text-text-3 font-mono text-xs">Fee 0.3%</span>
              </div>
            )}
          </div>

          <Button className="w-full" size="lg" disabled>
            {w.buttonLabel}
          </Button>

          <div className="border-border border px-4 py-3">
            <p className="text-text-2 text-xs">
              Wallet connection is coming soon.{" "}
              <span className="text-text">All rates are indicative</span> and may change before
              execution.
            </p>
          </div>
        </PageContent>
      </PageShell>
    </div>
  );
}
