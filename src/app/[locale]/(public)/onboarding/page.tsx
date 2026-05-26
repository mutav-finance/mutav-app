import { WelcomeScreen } from "@/components/onboarding/welcome-screen";
import { redirect } from "@/i18n/navigation";
import { resolveUserDestination } from "@/lib/user-destination";

export default async function OnboardingWelcomePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const dest = await resolveUserDestination();

  if (dest.kind === "dashboard") {
    redirect({ href: "/", locale });
  }
  if (dest.kind === "onboarding-status") {
    redirect({ href: `/onboarding/status?state=${dest.state}`, locale });
  }
  if (dest.kind === "onboarding-rejected") {
    redirect({ href: "/onboarding/rejected", locale });
  }

  return <WelcomeScreen />;
}
