import { useState } from "react";
import type { AssetSymbol } from "@/lib/stellar/assets";
import { applyInvestorFee, INVESTOR_FEE_RATE } from "@/lib/pricing/investor";
import { FUNDS } from "./fund-data";
import type { Fund, FundId } from "./fund-data";

export type OutputToken = AssetSymbol;

const XLM_PRICE_USD = 0.1234;

function toOutputAmount(inputUsd: number, token: OutputToken): number {
  return token === "XLM" ? inputUsd / XLM_PRICE_USD : inputUsd;
}

export type RedeemWidgetValues = {
  selectedFund: FundId;
  outputToken: OutputToken;
  rawAmount: string;
  fund: Fund;
  amount: number;
  inputUsd: number;
  feeUsd: number;
  outputAmount: number;
  ratePerFundToken: number;
  buttonLabel: string;
  hasAmount: boolean;
  setSelectedFund: (id: FundId) => void;
  setOutputToken: (token: OutputToken) => void;
  setRawAmount: (value: string) => void;
};

export function useRedeemWidget(initialFundId: FundId): RedeemWidgetValues {
  const [selectedFund, setSelectedFund] = useState<FundId>(initialFundId);
  const [outputToken, setOutputToken] = useState<OutputToken>("XLM");
  const [rawAmount, setRawAmount] = useState("");

  const fund = FUNDS.find((f) => f.id === selectedFund) ?? FUNDS[0];
  const amount = parseFloat(rawAmount) || 0;
  const inputUsd = amount * fund.navPrice;
  const { feeUsd, netUsd } = applyInvestorFee(inputUsd);
  const outputAmount = toOutputAmount(netUsd, outputToken);
  const ratePerFundToken = toOutputAmount(fund.navPrice * (1 - INVESTOR_FEE_RATE), outputToken);

  const hasAmount = amount > 0;
  const buttonLabel = hasAmount ? "Connect Wallet" : "Enter an amount";

  return {
    selectedFund,
    outputToken,
    rawAmount,
    fund,
    amount,
    inputUsd,
    feeUsd,
    outputAmount,
    ratePerFundToken,
    buttonLabel,
    hasAmount,
    setSelectedFund,
    setOutputToken,
    setRawAmount,
  };
}
