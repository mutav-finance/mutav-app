import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getStaffMember } from "@/lib/auth";

/**
 * `(admin)` route-group layout — the staff gate.
 *
 * Server-side check via `getStaffMember()` (which reads the Auth0
 * session). No session → redirect to Auth0 Universal Login, with
 * `returnTo` pointing back at admin so the user lands here after
 * authentication.
 *
 * **Stub posture**: when `getStaffMember()` evolves (A1 milestone) to
 * also assert a `mutavStaff` Convex row keyed off the Auth0 `sub`
 * claim, signed-in-but-not-staff users will hit a different branch
 * (403 page or "request access" affordance). For now, any authenticated
 * Auth0 user is allowed in — the connection itself (`mutavStaff` with
 * mandatory MFA + IP allowlist + disabled self-signup, spec § Section 7)
 * is the first defense.
 *
 * The full chrome (sidebar, header, shell-switcher) for the staff shell
 * lands with A1 per `docs/architecture/admin.md`. This layout deliberately
 * stays bare — it owns the auth gate and a skip-link, nothing else.
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
    // Auth0 SDK middleware mounts `/auth/login` at the root, outside
    // `[locale]`. `returnTo` brings the user back to the locale root
    // after Universal Login — admin.mutav.finance's root path IS the
    // staff landing (the entire origin is the admin shell, so there's
    // no `/admin` subpath to navigate to).
    redirect(`/auth/login?returnTo=/${locale}`);
  }

  return (
    <div className="bg-canvas flex h-full flex-col overflow-y-auto">
      <a href="#main-content" className="skip-link">
        {tA11y("skipToMain")}
      </a>
      <main id="main-content" data-front="mutav-staff" className="flex flex-1 flex-col">
        {children}
      </main>
    </div>
  );
}
