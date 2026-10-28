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
 * Server-side auth check via `getStaffMember()`, routing its four-way
 * result (loop-free by construction):
 *
 * - `anonymous` → Auth0 Universal Login (same-origin), `returnTo` back at
 *   admin so the user lands here after authentication.
 * - `not-staff` → `/access-denied` on THIS origin, which explains the denial
 *   and offers the agency app as a link. It sits outside this route group, so
 *   it is not re-gated, and it never redirects back here — no guard pair
 *   points at each other.
 * - `unavailable` → `/unavailable` on THIS origin. The staff read failed, so
 *   staff status is unknown: login would complete silently via SSO and fail
 *   the same read again (a login loop), and `/access-denied` would claim a
 *   denial nobody established. `/unavailable` sits outside this group and
 *   never redirects; its "Try again" is a user-initiated link back here.
 * - `staff` → render the shell.
 *
 * Fail-closed: no failure ever renders the shell. A session-decrypt error is
 * `anonymous`; a staff-fetch error is `unavailable`.
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
  if (result.kind === "unavailable") {
    localeRedirect({ href: "/unavailable", locale });
  }
  // next-intl's `redirect` throws but is not typed `never`, so the branches
  // above do not narrow `result`. Unreachable at runtime; never renders the
  // shell for a non-staff result.
  if (result.kind !== "staff") return null;

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
