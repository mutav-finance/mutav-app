import { PageContent } from "@/components/page/page-content";
import { OnboardingWizard } from "@/components/onboarding/onboarding-wizard";

export default function OnboardingWizardPage() {
  return (
    <PageContent variant="narrow" className="py-8 md:py-12">
      <OnboardingWizard />
    </PageContent>
  );
}
