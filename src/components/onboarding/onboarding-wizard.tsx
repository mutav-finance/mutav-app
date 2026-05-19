"use client";

import { useTranslations } from "next-intl";
import { WizardStepIndicator } from "@/components/onboarding/wizard-step-indicator";
import { WizardStep1 } from "@/components/onboarding/wizard-step1";
import { WizardStepBanking } from "@/components/onboarding/wizard-step-banking";
import { WizardStepDocuments } from "@/components/onboarding/wizard-step-documents";
import { WizardStepReview } from "@/components/onboarding/wizard-step-review";
import {
  useOnboardingWizard,
  type OnboardingWizardData,
} from "@/components/onboarding/use-onboarding-wizard";

// Re-export the data type so the wizard-step-* components can keep importing
// it from this module. The hook owns the canonical declaration.
export type { OnboardingWizardData };

export function OnboardingWizard({ initialType }: { initialType?: "autonomo" | "empresa" }) {
  const t = useTranslations("onboarding.wizard");
  const vm = useOnboardingWizard({ initialType });

  if (vm.isSubmitted) {
    return (
      <div className="flex flex-col items-center gap-4 py-12 text-center">
        <p className="text-text text-lg font-medium">{t("submitted.title")}</p>
        <p className="text-text-2 max-w-sm text-sm">{t("submitted.subtitle")}</p>
        <p className="text-text-3 text-xs">{t("submitted.detail", { email: vm.data.email })}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <WizardStepIndicator
        current={vm.currentStep}
        labels={vm.stepLabels}
        progressLabel={t("progressLabel")}
        doneSuffix={t("stepDoneSuffix")}
        currentSuffix={t("stepCurrentSuffix")}
      />

      {vm.errorMessage && (
        <p
          role="alert"
          className="border-error/30 bg-error/5 text-error border-l-2 px-4 py-2 text-sm"
        >
          {vm.errorMessage}
        </p>
      )}

      {vm.stepKind === "profile" && (
        <WizardStep1
          initialValues={vm.data}
          serverErrorCode={vm.errorCode}
          onSubmit={vm.handleStep1Submit}
          isSubmitting={vm.isSubmitting}
        />
      )}

      {vm.stepKind === "banking" && (
        <WizardStepBanking
          data={vm.data}
          onChange={vm.patch}
          onNext={vm.handleBankingNext}
          onBack={vm.handleBack}
          isSubmitting={vm.isSubmitting}
        />
      )}

      {vm.stepKind === "documents" &&
        (vm.agencyId ? (
          <WizardStepDocuments
            agencyId={vm.agencyId}
            onNext={vm.handleDocumentsNext}
            onBack={vm.handleBack}
          />
        ) : (
          <p role="alert" className="text-error text-sm">
            {t("errors.unknown")}
          </p>
        ))}

      {vm.stepKind === "review" && (
        <WizardStepReview
          data={vm.data}
          onSubmit={vm.handleSubmit}
          onBack={vm.handleBack}
          onGoTo={vm.handleGoTo}
          isSubmitting={vm.isSubmitting}
        />
      )}
    </div>
  );
}
