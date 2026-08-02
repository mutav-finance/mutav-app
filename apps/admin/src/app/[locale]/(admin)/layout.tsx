import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { AdminHeaderActions } from "@/components/admin-header-actions";
import { AdminNav } from "@/components/admin-nav";
import { AdminSidebarHeader } from "@/components/admin-sidebar-header";
import { redirect as localeRedirect } from "@mutav/i18n/navigation";
import { NavUser } from "@mutav/ui/nav-user";
import { AppShell } from "@mutav/ui/shell/app-shell";
import { getStaffMember } from "@/lib/auth";

/**
 * `(admin)` route-group layout — the staff gate + shell.
 *
 * Server-side auth check via `getStaffMember()`, routing its three-way
 * result (loop-free by construction):
 *
 * - `anonymous` → Auth0 Universal Login (same-origin), `returnTo` back at
 *   admin so the user lands here after authentication.
 * - `not-staff` → `/access-denied` on THIS origin, which explains the denial
 *   and offers the agency app as a link. It sits outside this route group, so
 *   it is not re-gated, and it never redirects back here — no guard pair
 *   points at each other.
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
    // next-intl's redirect, not `next/navigation`'s: `localePrefix: "as-needed"`
    // means the default locale carries no prefix, so a hand-built
    // `/${locale}/access-denied` would not resolve for pt-BR.
    localeRedirect({ href: "/access-denied", locale });
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
    <AppShell
      sidebarHeader={<AdminSidebarHeader />}
      nav={<AdminNav />}
      identity={<NavUser user={user} />}
      headerEnd={<AdminHeaderActions />}
      dataFront="mutav-staff"
      skipToMainLabel={tA11y("skipToMain")}
    >
      {children}
    </AppShell>
  );
}
