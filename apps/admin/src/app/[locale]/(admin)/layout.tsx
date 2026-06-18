import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AppSidebar } from "@/components/app-sidebar";
import { SiteHeader } from "@/components/site-header";
import { SidebarInset, SidebarProvider } from "@mutav/ui/sidebar";
import { ThemeProvider } from "@/providers/theme";
import { getStaffMember } from "@/lib/auth";

/**
 * `(admin)` route-group layout — the staff gate + shell.
 *
 * Server-side auth check via `getStaffMember()` (reads the Auth0 session).
 * No session → redirect to Auth0 Universal Login with `returnTo` pointing
 * back at admin so the user lands here after authentication.
 *
 * `getStaffMember()` is fail-closed: it returns `null` for both the
 * not-signed-in case and the signed-in-but-not-staff case (no `mutavStaff`
 * row in Convex), so both fall through to the Universal Login redirect.
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

  const member = await getStaffMember();
  if (!member) {
    redirect(`/auth/login?returnTo=/${locale}`);
  }

  // Empty strings are valid Auth0 claim values (`name: ""`) and would slip
  // past `??`, leaving the avatar to render "UNDEFINED" initials. `||` on
  // a trimmed value falls through to the next fallback.
  const user = {
    name: member.session.user.name?.trim() || member.session.user.email?.trim() || "Staff",
    email: member.session.user.email?.trim() || "",
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
      </SidebarProvider>
    </ThemeProvider>
  );
}
