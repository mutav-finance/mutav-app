import { redirect as nextRedirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { fetchQuery } from "convex/nextjs";
import { api } from "@convex/_generated/api";
import { AppSidebar } from "@/components/app-sidebar";
import { SiteHeader } from "@/components/site-header";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/providers/theme";
import { redirect } from "@/i18n/navigation";
import { getAuthToken } from "@/lib/auth-token";

/**
 * Server-side guard. Three exit branches before rendering the shell:
 * 1. No Auth0 session → `/auth/login` (proxy handles the OAuth dance)
 * 2. Authenticated but zero agency memberships → `/onboarding`
 * 3. Agencies exist but none `active` (all in_progress/submitted/etc.) →
 *    `/onboarding/status`
 *
 * `/auth/login` uses Next's native `redirect` because the Auth0 proxy
 * matches the bare `/auth/*` paths regardless of locale prefix —
 * pushing a locale segment in front would miss the matcher.
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

  const token = await getAuthToken();
  if (!token) {
    nextRedirect("/auth/login");
  }

  const agencies = await fetchQuery(
    api.agencies.useCases.listAgenciesForUser,
    {},
    { token: token! },
  );

  if (agencies.length === 0) {
    redirect({ href: "/onboarding", locale });
  }

  const hasActive = agencies.some((a) => a && a.onboardingState === "active");
  if (!hasActive) {
    redirect({ href: "/onboarding/status", locale });
  }

  return (
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem disableTransitionOnChange>
      <SidebarProvider
        className="h-svh overflow-hidden"
        style={
          {
            "--sidebar-width": "calc(var(--spacing) * 72)",
            "--header-height": "calc(var(--spacing) * 12)",
          } as React.CSSProperties
        }
      >
        <a href="#main-content" className="skip-link">
          {tA11y("skipToMain")}
        </a>
        <AppSidebar variant="inset" />
        <SidebarInset className="min-h-0">
          <SiteHeader />
          <main
            id="main-content"
            data-front="imobiliarias"
            className="flex min-h-0 flex-1 flex-col overflow-y-auto"
          >
            {children}
          </main>
        </SidebarInset>
        <Toaster />
      </SidebarProvider>
    </ThemeProvider>
  );
}
