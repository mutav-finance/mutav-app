import { redirect as nextRedirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AppSidebar } from "@/components/app-sidebar";
import { SiteHeader } from "@/components/site-header";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { Toaster } from "@mutav/ui/sonner";
import { ThemeProvider } from "@/providers/theme";
import { redirect } from "@/i18n/navigation";
import { resolveUserDestination } from "@/lib/user-destination";

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
