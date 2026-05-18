import { useState } from "react";
import type { AssetSymbol } from "@/lib/stellar/assets";
import { applyInvestorFee } from "@/lib/pricing/investor";
import { FUNDS } from "./fund-data";
import type { Fund, FundId } from "./fund-data";

export type InputToken = AssetSymbol;

const XLM_PRICE_USD = 0.1234;

function toInputUsd(amount: number, token: InputToken): number {
  return token === "XLM" ? amount * XLM_PRICE_USD : amount;
}

export type DepositWidgetValues = {
  selectedFund: FundId;
  inputToken: InputToken;
  rawAmount: string;
  fund: Fund;
  amount: number;
  inputUsd: number;
  feeUsd: number;
  outputAmount: number;
  ratePerInputToken: number;
  buttonLabel: string;
  hasAmount: boolean;
  setSelectedFund: (id: FundId) => void;
  setInputToken: (token: InputToken) => void;
  setRawAmount: (value: string) => void;
};

export function useDepositWidget(initialFundId: FundId): DepositWidgetValues {
  const [selectedFund, setSelectedFund] = useState<FundId>(initialFundId);
  const [inputToken, setInputToken] = useState<InputToken>("XLM");
  const [rawAmount, setRawAmount] = useState("");

  const fund = FUNDS.find((f) => f.id === selectedFund) ?? FUNDS[0];
  const amount = parseFloat(rawAmount) || 0;
  const inputUsd = toInputUsd(amount, inputToken);
  const { feeUsd, netUsd } = applyInvestorFee(inputUsd);
  const outputAmount = netUsd / fund.navPrice;
  const ratePerInputToken = toInputUsd(1, inputToken) / fund.navPrice;

  const hasAmount = amount > 0;
  const buttonLabel = hasAmount ? "Connect Wallet" : "Enter an amount";

  return {
    selectedFund,
    inputToken,
    rawAmount,
    fund,
    amount,
    inputUsd,
    feeUsd,
    outputAmount,
    ratePerInputToken,
    buttonLabel,
    hasAmount,
    setSelectedFund,
    setInputToken,
    setRawAmount,
  };
}
