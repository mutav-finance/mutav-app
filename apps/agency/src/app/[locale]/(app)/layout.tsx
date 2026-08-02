import { redirect as nextRedirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AgencyIdentity } from "@/components/agency-identity";
import { AgencyNav } from "@/components/agency-nav";
import { AgencySidebarHeader } from "@/components/agency-sidebar-header";
import { ShellSwitcher } from "@/components/shell-switcher";
import { AppShell } from "@mutav/ui/shell/app-shell";
import { redirect } from "@mutav/i18n/navigation";
import { resolveUserDestination } from "@/lib/user-destination";
import { buildCrossAppUrl } from "@mutav/i18n/cross-app";
import { getAdminUrl } from "@/lib/env";

/**
 * Server-side guard. Resolves the user's canonical destination and
 * renders the (app) shell only when that destination is `dashboard`.
 */
export default async function AppLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const tA11y = await getTranslations({ locale, namespace: "common.a11y" });

  const dest = await resolveUserDestination();
  if (dest.kind === "login") {
    nextRedirect("/auth/login");
  }
  if (dest.kind === "staff") {
    // Cross-origin jump to the admin app — built from a trusted env base,
    // so `next/navigation` redirect with an absolute URL, NOT the
    // next-intl wrapper (which is same-origin only).
    nextRedirect(buildCrossAppUrl(getAdminUrl(), locale));
  }
  if (dest.kind === "onboarding-welcome") {
    redirect({ href: "/onboarding", locale });
  }
  if (dest.kind === "onboarding-status") {
    redirect({ href: `/onboarding/status?state=${dest.state}`, locale });
  }
  if (dest.kind === "onboarding-rejected") {
    redirect({ href: "/onboarding/rejected", locale });
  }

  return (
    <AppShell
      sidebarHeader={<AgencySidebarHeader />}
      nav={<AgencyNav />}
      identity={<AgencyIdentity />}
      headerEnd={<ShellSwitcher />}
      dataFront="imobiliarias"
      skipToMainLabel={tA11y("skipToMain")}
    >
      {children}
    </AppShell>
  );
}
