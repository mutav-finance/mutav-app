import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AppSidebar } from "@/components/app-sidebar";
import { SiteHeader } from "@/components/site-header";
import { SidebarInset, SidebarProvider } from "@mutav/ui/sidebar";
import { Toaster } from "@mutav/ui/sonner";
import { ThemeProvider } from "@/providers/theme";
import { getStaffMember } from "@/lib/auth";
import { buildCrossAppUrl } from "@/lib/cross-app";
import { getAgencyUrl } from "@/lib/env";

/**
 * `(admin)` route-group layout — the staff gate + shell.
 *
 * Server-side auth check via `getStaffMember()`, routing its three-way
 * result (loop-free by construction):
 *
 * - `anonymous` → Auth0 Universal Login (same-origin), `returnTo` back at
 *   admin so the user lands here after authentication.
 * - `not-staff` → the AGENCY app ORIGIN (cross-origin), NOT login — an
 *   authenticated non-staff user has a home there. Bouncing to the agency
 *   origin (which never redirects back to admin for a non-staff-with-agency
 *   user) means no guard pair points at each other.
 * - `staff` → render the shell.
 *
 * Fail-closed: a session-decrypt or staff-fetch error resolves to
 * `anonymous`, so a possibly-staff user is never bounced out of admin.
 */
export default async function AdminLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const tA11y = await getTranslations({ locale, namespace: "common.a11y" });

  const result = await getStaffMember();
  if (result.kind === "anonymous") {
    redirect(`/auth/login?returnTo=/${locale}`);
  }
  if (result.kind === "not-staff") {
    // Cross-origin bounce to the agency app — absolute URL from a trusted
    // env base, so `next/navigation` redirect (the next-intl wrapper is
    // same-origin only).
    redirect(buildCrossAppUrl(getAgencyUrl(), locale));
  }

  // Empty strings are valid Auth0 claim values (`name: ""`) and would slip
  // past `??`, leaving the avatar to render "UNDEFINED" initials. `||` on
  // a trimmed value falls through to the next fallback.
  const user = {
    name: result.session.user.name?.trim() || result.session.user.email?.trim() || "Staff",
    email: result.session.user.email?.trim() || "",
    // Intentionally omit `picture`. Staff sessions can return social-provider
    // URLs (Gravatar, googleusercontent) that don't match the staff CSP
    // `img-src` allowlist; rather than widening the allowlist on a high-
    // privilege surface, render initials. Revisit when A1 provisions staff
    // pictures from a controlled source.
  };

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
        <AppSidebar variant="inset" user={user} />
        <SidebarInset className="min-h-0">
          <SiteHeader />
          <main
            id="main-content"
            data-front="mutav-staff"
            className="@container/main flex min-h-0 flex-1 flex-col overflow-y-auto"
          >
            {children}
          </main>
        </SidebarInset>
        <Toaster />
      </SidebarProvider>
    </ThemeProvider>
  );
}
