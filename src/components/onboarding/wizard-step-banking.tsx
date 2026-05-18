"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  type OnboardingWizardData,
  isBankAccountType,
} from "@/components/onboarding/onboarding-wizard";

type Props = {
  data: OnboardingWizardData;
  onChange: (patch: Partial<OnboardingWizardData>) => void;
  onNext: () => void;
  onBack: () => void;
  isSubmitting: boolean;
};

type BankingErrors = {
  bank?: string;
  branch?: string;
  account?: string;
  accountType?: string;
};

const ACCOUNT_TYPE_LABEL_ID = "account-type-label";

export function WizardStepBanking({ data, onChange, onNext, onBack, isSubmitting }: Props) {
  const t = useTranslations("onboarding.wizard.banking");
  const [errors, setErrors] = React.useState<BankingErrors>({});

  const handleNext = () => {
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
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field id="field-bank" label={t("bankLabel")} error={errors.bank} className="sm:col-span-2">
          <Input
            id="field-bank"
            value={data.bankName}
            placeholder={t("bankPlaceholder")}
            onChange={(e) => onChange({ bankName: e.target.value })}
          />
        </Field>

        <Field id="field-branch" label={t("branchLabel")} error={errors.branch}>
          <Input
            id="field-branch"
            value={data.bankBranch}
            placeholder={t("branchPlaceholder")}
            inputMode="numeric"
            onChange={(e) => onChange({ bankBranch: e.target.value })}
          />
        </Field>

        <Field id="field-account" label={t("accountLabel")} error={errors.account}>
          <Input
            id="field-account"
            value={data.bankAccount}
            placeholder={t("accountPlaceholder")}
            onChange={(e) => onChange({ bankAccount: e.target.value })}
          />
        </Field>

        <div className="flex flex-col gap-2 sm:col-span-2">
          <span id={ACCOUNT_TYPE_LABEL_ID} className="text-sm font-medium">
            {t("accountTypeLabel")}
          </span>
          <div
            role="group"
            aria-labelledby={ACCOUNT_TYPE_LABEL_ID}
            className="grid grid-cols-2 gap-2"
          >
            {(["corrente", "poupanca"] as const).map((type) => (
              <button
                key={type}
                type="button"
                aria-pressed={data.bankAccountType === type}
                onClick={() => onChange({ bankAccountType: type })}
                className={cn(
                  "border px-4 py-2 text-sm font-medium transition-colors",
                  data.bankAccountType === type
                    ? "border-accent bg-accent/5 text-accent"
                    : "border-border text-text-2 hover:border-text-3 hover:text-text",
                )}
              >
                {type === "corrente" ? t("accountTypeCorrente") : t("accountTypePoupanca")}
              </button>
            ))}
          </div>
          {errors.accountType && (
            <p className="text-error text-xs" role="alert">
              {errors.accountType}
            </p>
          )}
        </div>

        <Field
          id="field-pix"
          label={t("pixKeyLabel")}
          hint={t("pixKeyHint")}
          className="sm:col-span-2"
        >
          <Input
            id="field-pix"
            value={data.bankPixKey}
            placeholder={t("pixKeyPlaceholder")}
            onChange={(e) => onChange({ bankPixKey: e.target.value })}
          />
        </Field>
      </div>

      <div className="flex items-center justify-between">
        <Button variant="outline" onClick={onBack} disabled={isSubmitting}>
          {t("backButton")}
        </Button>
        <Button size="lg" onClick={handleNext} disabled={isSubmitting}>
          {isSubmitting ? t("savingButton") : t("nextButton")}
        </Button>
      </div>
    </div>
  );
}

function Field({
  id,
  label,
  hint,
  error,
  children,
  className,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && !error && <p className="text-text-3 text-xs">{hint}</p>}
      {error && (
        <p className="text-error text-xs" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
