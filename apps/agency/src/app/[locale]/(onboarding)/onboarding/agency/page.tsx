import { redirect } from "@/i18n/navigation";
import { PageContent } from "@mutav/ui/page/page-content";
import { OnboardingFlow } from "@/components/onboarding/onboarding-flow";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ type?: string }>;
};

export default async function OnboardingAgencyPage({ params, searchParams }: Props) {
  const { locale } = await params;
  const { type } = await searchParams;
  const initialType = type === "autonomo" || type === "empresa" ? type : undefined;

  if (!initialType) {
    redirect({ href: "/onboarding", locale });
  }

  return (
    <PageContent variant="narrow" className="py-8 md:py-12">
      <OnboardingFlow initialType={initialType} />
    </PageContent>
  );
}
