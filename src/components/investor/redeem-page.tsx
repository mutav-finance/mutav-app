"use client";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger } from "@/components/ui/select";
import { PageShell } from "@/components/page/page-shell";
import { PageContent } from "@/components/page/page-content";
import { ProtocolKpiStrip } from "./protocol-kpi-strip";
import { useRedeemWidget } from "./use-redeem-widget";
import { isAssetSymbol } from "@/lib/stellar/assets";
import { FUNDS, RISK_COLOR, PROTOCOL_STATS, isFundId } from "./fund-data";
import type { FundId } from "./fund-data";
import type { OutputToken } from "./use-redeem-widget";

// Mock investor positions — replaced by real balances once wallet connects
const MOCK_POSITIONS: Record<FundId, { balance: number; valueUsd: number }> = {
  MTVL: { balance: 482.3156, valueUsd: 497.59 },
  MTVM: { balance: 217.8802, valueUsd: 236.29 },
  MTVH: { balance: 0, valueUsd: 0 },
};

function PositionsStrip() {
  return (
    <div>
      <p className="text-text-3 mb-2 text-xs tracking-wider uppercase">Your Positions</p>
      <div className="border-border flex border">
        {FUNDS.map((fund, i) => {
          const pos = MOCK_POSITIONS[fund.id];
          return (
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
              <span className="text-text font-mono text-base font-semibold">
                {pos.balance > 0 ? pos.balance.toFixed(2) : "—"}
              </span>
              <span className="text-text-3 text-xs">
                {pos.balance > 0 ? `$${pos.valueUsd.toFixed(2)}` : "No position"}
              </span>
            </div>
          );
        })}
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

function RedemptionNotice({ outputToken }: { outputToken: OutputToken }) {
  return (
    <div className="border-border border px-4 py-3">
      <p className="text-text-2 text-xs">
        Redemptions are processed within <span className="text-text">3–5 business days</span>. You
        will receive <span className="text-text">{outputToken}</span> after the review period ends.
      </p>
    </div>
  );
}

export function RedeemPage({ initialFund }: { initialFund: string | undefined }) {
  const validFundId = (
    initialFund === "MTVL" || initialFund === "MTVM" || initialFund === "MTVH"
      ? initialFund
      : "MTVL"
  ) satisfies FundId;

  const w = useRedeemWidget(validFundId);

  return (
    <div className="flex flex-1 flex-col">
      <ProtocolKpiStrip stats={PROTOCOL_STATS} variant="narrow" />
      <PageShell>
        <PageContent variant="narrow">
          <PositionsStrip />

          {/* Swap card */}
          <div className="border-border bg-surface border">
            {/* YOU PAY — fund token */}
            <div className="p-5">
              <span className="text-text-2 text-xs tracking-wider uppercase">You Pay</span>
              <div className="mt-3 flex items-center gap-3">
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder="0"
                  value={w.rawAmount}
                  onChange={(e) => w.setRawAmount(e.target.value)}
                  aria-label="Amount to redeem"
                  className="text-text placeholder:text-text-3 min-w-0 flex-1 bg-transparent font-mono text-3xl outline-none"
                />
                <Select
                  value={w.selectedFund}
                  onValueChange={(v) => {
                    if (isFundId(v)) w.setSelectedFund(v);
                  }}
                >
                  <SelectTrigger className="border-border h-9 w-auto shrink-0">
                    <div className="flex items-center gap-2">
                      <span
                        className={`size-1.5 shrink-0 ${RISK_COLOR[w.fund.risk]}`}
                        aria-hidden
                      />
                      <span className="text-text font-mono text-sm">{w.selectedFund}</span>
                    </div>
                  </SelectTrigger>
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
                {w.amount > 0 ? `≈ $${w.inputUsd.toFixed(2)} USD` : " "}
              </span>
            </div>

            <SwapDivider />

            {/* YOU RECEIVE — XLM or USDC */}
            <div className="p-5">
              <span className="text-text-2 text-xs tracking-wider uppercase">You Receive</span>
              <div className="mt-3 flex items-center gap-3">
                <span className="text-text flex-1 font-mono text-3xl">
                  {w.amount > 0 ? w.outputAmount.toFixed(4) : "0"}
                </span>
                <Select
                  value={w.outputToken}
                  onValueChange={(v) => {
                    if (isAssetSymbol(v)) w.setOutputToken(v);
                  }}
                >
                  <SelectTrigger className="border-border h-9 w-auto shrink-0">
                    <span className="text-text font-mono text-sm">{w.outputToken}</span>
                  </SelectTrigger>
                  <SelectContent className="dark" position="popper">
                    <SelectItem value="XLM">XLM</SelectItem>
                    <SelectItem value="USDC">USDC</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <span className="text-text-2 mt-2 block font-mono text-sm">
                {w.fund.name} · NAV ${w.fund.navPrice.toFixed(4)}
              </span>
            </div>

            {/* Rate + fee */}
            {w.amount > 0 && (
              <div className="border-border flex items-center justify-between border-t px-5 py-3">
                <span className="text-text-2 font-mono text-xs">
                  1 {w.selectedFund} ≈ {w.ratePerFundToken.toFixed(4)} {w.outputToken}
                </span>
                <span className="text-text-3 font-mono text-xs">Fee 0.3%</span>
              </div>
            )}
          </div>

          <Button className="w-full" size="lg" disabled>
            {w.buttonLabel}
          </Button>

          <RedemptionNotice outputToken={w.outputToken} />
        </PageContent>
      </PageShell>
    </div>
  );
}
