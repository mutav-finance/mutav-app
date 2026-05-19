"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import type { OnboardingWizardData } from "@/components/onboarding/use-onboarding-wizard";

export type BankingErrors = {
  bank?: string;
  branch?: string;
  account?: string;
  accountType?: string;
};

export function isBankAccountType(t: string): t is "corrente" | "poupanca" {
  return t === "corrente" || t === "poupanca";
}

export function useWizardStepBanking({
  data,
  onNext,
}: {
  data: OnboardingWizardData;
  onNext: () => void;
}) {
  const t = useTranslations("onboarding.wizard.banking");
  const [errors, setErrors] = React.useState<BankingErrors>({});
  const accountTypeLabelId = React.useId();

  const handleNext = React.useCallback(() => {
    const errs: BankingErrors = {};

    if (!data.bankName.trim()) errs.bank = t("errors.bank");
    if (!data.bankBranch.trim()) errs.branch = t("errors.branch");
    if (!data.bankAccount.trim()) errs.account = t("errors.account");
    if (!isBankAccountType(data.bankAccountType)) errs.accountType = t("errors.accountType");

    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }

    setErrors({});
    onNext();
  }, [data, onNext, t]);

  return {
    errors,
    accountTypeLabelId,
    handleNext,
  };
}
