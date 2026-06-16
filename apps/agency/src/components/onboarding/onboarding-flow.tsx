"use client";

import { useTranslations } from "next-intl";
import { StepIndicator } from "@mutav/ui/step-indicator";
import { StepProfile } from "@/components/onboarding/step-profile";
import { StepBanking } from "@/components/onboarding/step-banking";
import { StepDocuments } from "@/components/onboarding/step-documents";
import { StepReview } from "@/components/onboarding/step-review";
import { useOnboardingFlow } from "@/components/onboarding/use-onboarding-flow";

export function OnboardingFlow({ initialType }: { initialType?: "autonomo" | "empresa" }) {
  const t = useTranslations("onboarding");
  const vm = useOnboardingFlow({ initialType });

  if (vm.isSubmitted) {
    return (
      <div className="flex flex-col items-center gap-4 py-12 text-center">
        <p className="text-text text-lg font-medium">{t("submitted.title")}</p>
        <p className="text-text-2 max-w-sm text-sm">{t("submitted.subtitle")}</p>
        <p className="text-text-3 text-xs">{t("submitted.detail", { email: vm.snapshot.email })}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      <StepIndicator
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
        <StepProfile
          initialValues={vm.snapshot}
          serverErrorCode={vm.errorCode}
          onSubmit={vm.handleStep1Submit}
          isSubmitting={vm.isSubmitting}
        />
      )}

      {vm.stepKind === "banking" && (
        <StepBanking
          initialValues={vm.snapshot}
          serverErrorCode={vm.errorCode}
          agencyType={vm.snapshot.agencyType}
          onSubmit={vm.handleBankingSubmit}
          onBack={vm.handleBack}
          isSubmitting={vm.isSubmitting}
        />
      )}

      {vm.stepKind === "documents" &&
        (vm.agencyId ? (
          <StepDocuments
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
        <StepReview
          snapshot={vm.snapshot}
          onSubmit={vm.handleReviewSubmit}
          onBack={vm.handleBack}
          onGoTo={vm.handleGoTo}
          isSubmitting={vm.isSubmitting}
        />
      )}
    </div>
  );
}
