import { getTranslations } from "next-intl/server";
import { PublicShell } from "@/components/public/public-shell";
import { Toaster } from "@/components/ui/sonner";

/**
 * Chrome for the agency-staff onboarding flow. Previously this layout
 * lived at `[locale]/(public)/layout.tsx` and was shared with the tenant
 * pay routes; pay has since moved to its own origin (apps/pay), so the
 * `(public)` route group is gone and this content lives in its own
 * `(onboarding)` group. The inner `onboarding/layout.tsx` still owns the
 * staff-specific header (with Auth0 logout).
 */
export default async function OnboardingGroupLayout({ children }: { children: React.ReactNode }) {
  const tA11y = await getTranslations("common.a11y");

  return (
    <PublicShell>
      <a href="#primary-action" className="skip-link">
        {tA11y("skipToMain")}
      </a>
      <main id="public-main" data-front="imobiliarias" className="flex min-h-0 flex-1 flex-col">
        {children}
      </main>
      <Toaster />
    </PublicShell>
  );
}
