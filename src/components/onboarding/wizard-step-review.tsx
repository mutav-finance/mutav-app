"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import type { OnboardingWizardData } from "@/components/onboarding/onboarding-wizard";

type Props = {
  data: OnboardingWizardData;
  onSubmit: () => void;
  onBack: () => void;
  onGoTo: (step: number) => void;
  isSubmitting: boolean;
};

export function WizardStepReview({ data, onSubmit, onBack, onGoTo, isSubmitting }: Props) {
  const t = useTranslations("onboarding.wizard.review");

  const agencyTypeLabel =
    data.agencyType === "autonomo" ? t("agencyTypeAutonomo") : t("agencyTypeEmpresa");
  const documentValue = data.agencyType === "autonomo" ? data.cpf : data.cnpj;
  const accountTypeLabel =
    data.bankAccountType === "corrente" ? t("accountTypeCorrente") : t("accountTypePoupanca");

  // Etapa do banking varia conforme o tipo: autonomo pula documentos
  const bankingStep = data.agencyType === "empresa" ? 3 : 2;

  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="review-profile-heading">
        <div className="mb-3 flex items-center justify-between">
          <h3
            id="review-profile-heading"
            className="text-text-3 font-mono text-xs tracking-wide uppercase"
          >
            {t("profileSection")}
          </h3>
          <button
            type="button"
            onClick={() => onGoTo(1)}
            disabled={isSubmitting}
            className="text-accent font-mono text-xs hover:opacity-80 disabled:opacity-40"
          >
            {t("editButton")}
          </button>
        </div>
        <div className="border-border divide-border divide-y border">
          <ReviewRow label={t("agencyTypeLabel")} value={agencyTypeLabel} />
          <ReviewRow label={t("nameLabel")} value={data.name} />
          <ReviewRow label={t("documentLabel")} value={documentValue} />
          <ReviewRow label={t("creciLabel")} value={data.creci} />
          <ReviewRow label={t("emailLabel")} value={data.email} />
          <ReviewRow label={t("phoneLabel")} value={data.phone} />
        </div>
      </section>

      <section aria-labelledby="review-banking-heading">
        <div className="mb-3 flex items-center justify-between">
          <h3
            id="review-banking-heading"
            className="text-text-3 font-mono text-xs tracking-wide uppercase"
          >
            {t("bankingSection")}
          </h3>
          <button
            type="button"
            onClick={() => onGoTo(bankingStep)}
            disabled={isSubmitting}
            className="text-accent font-mono text-xs hover:opacity-80 disabled:opacity-40"
          >
            {t("editButton")}
          </button>
        </div>
        <div className="border-border divide-border divide-y border">
          <ReviewRow label={t("bankLabel")} value={data.bankName} />
          <ReviewRow label={t("branchLabel")} value={data.bankBranch} />
          <ReviewRow label={t("accountLabel")} value={data.bankAccount} />
          <ReviewRow label={t("accountTypeLabel")} value={accountTypeLabel} />
          <ReviewRow
            label={t("pixKeyLabel")}
            value={data.bankPixKey || t("notProvided")}
            muted={!data.bankPixKey}
          />
        </div>
      </section>

      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          disabled={isSubmitting}
          className="text-text-2 hover:text-text font-mono text-sm disabled:opacity-50"
        >
          {t("backButton")}
        </button>
        <Button onClick={onSubmit} disabled={isSubmitting}>
          {isSubmitting ? t("submittingButton") : t("submitButton")}
        </Button>
      </div>
    </div>
  );
}

function ReviewRow({
  label,
  value,
  muted = false,
}: {
  label: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3">
      <span className="text-text-3 shrink-0 text-sm">{label}</span>
      <span
        className={
          muted
            ? "text-text-3 min-w-0 truncate text-right text-sm"
            : "text-text min-w-0 truncate text-right text-sm font-medium"
        }
      >
        {value}
      </span>
    </div>
  );
}
