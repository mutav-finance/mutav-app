"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import type { OnboardingWizardData } from "@/components/onboarding/use-onboarding-wizard";

export function useWizardStepReview({
  data,
  onSubmit,
}: {
  data: OnboardingWizardData;
  onSubmit: (opts: { consentMarketing: boolean }) => void;
}) {
  const t = useTranslations("onboarding.wizard.review");
  const [consentMarketing, setConsentMarketing] = React.useState(false);

  const agencyTypeLabel =
    data.agencyType === "autonomo" ? t("agencyTypeAutonomo") : t("agencyTypeEmpresa");

  const documentValue = data.agencyType === "autonomo" ? data.cpf : data.cnpj;

  const accountTypeLabel =
    data.bankAccountType === "corrente"
      ? t("accountTypeCorrente")
      : data.bankAccountType === "poupanca"
        ? t("accountTypePoupanca")
        : "—";

  // Banking step number varies by type — autonomo skips documents
  const bankingStep = data.agencyType === "empresa" ? 3 : 2;

  const toggleConsentMarketing = React.useCallback((checked: boolean) => {
    setConsentMarketing(checked);
  }, []);

  const handleSubmit = React.useCallback(() => {
    onSubmit({ consentMarketing });
  }, [consentMarketing, onSubmit]);

  return {
    consentMarketing,
    agencyTypeLabel,
    documentValue,
    accountTypeLabel,
    bankingStep,
    toggleConsentMarketing,
    handleSubmit,
  };
}
