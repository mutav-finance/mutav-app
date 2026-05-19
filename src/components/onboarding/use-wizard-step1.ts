"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { isValidCPF, isValidCNPJ } from "@/lib/brazil";
import type { OnboardingWizardData } from "@/components/onboarding/use-onboarding-wizard";

export type WizardStep1Errors = Partial<Record<keyof OnboardingWizardData, string>>;

export function isAgencyTypeSelected(t: string): t is "autonomo" | "empresa" {
  return t === "autonomo" || t === "empresa";
}

export function useWizardStep1({
  data,
  onNext,
}: {
  data: OnboardingWizardData;
  onNext: (agencyType: "autonomo" | "empresa") => void;
}) {
  const t = useTranslations("onboarding.step1");
  const [errors, setErrors] = React.useState<WizardStep1Errors>({});

  const handleNext = React.useCallback(() => {
    const errs: WizardStep1Errors = {};

    if (!isAgencyTypeSelected(data.agencyType)) errs.agencyType = t("errors.agencyType");
    if (!data.name.trim()) errs.name = t("errors.name");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) errs.email = t("errors.email");
    if (data.phone.replace(/\D/g, "").length < 10) errs.phone = t("errors.phone");
    if (!data.creci.trim()) errs.creci = t("errors.creci");

    if (data.agencyType === "autonomo") {
      if (!isValidCPF(data.cpf)) errs.cpf = t("errors.cpf");
    }
    if (data.agencyType === "empresa") {
      if (!isValidCNPJ(data.cnpj)) errs.cnpj = t("errors.cnpj");
      if (!data.representanteName.trim()) errs.representanteName = t("errors.representanteName");
      if (!isValidCPF(data.representanteCpf)) {
        errs.representanteCpf = t("errors.representanteCpf");
      }
    }

    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }

    if (!isAgencyTypeSelected(data.agencyType)) return;

    setErrors({});
    onNext(data.agencyType);
  }, [data, onNext, t]);

  return {
    errors,
    handleNext,
  };
}
