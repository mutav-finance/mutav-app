import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { PublicFooter } from "@mutav/ui/public/public-footer";
import { auth0 } from "@/lib/auth0";

export default async function OnboardingLayout({ children }: { children: React.ReactNode }) {
  const session = await auth0.getSession();
  const t = await getTranslations("userMenu");

  return (
    <>
      <header className="border-border bg-canvas border-b">
        <div className="flex h-14 items-center px-4 lg:px-6">
          <Link href="/onboarding" className="flex items-center gap-2.5" aria-label="MUTAV">
            <span className="bg-accent size-3.5" aria-hidden />
            <span className="font-mono text-sm font-semibold tracking-widest">MUTAV</span>
          </Link>
          {session && (
            /*
             * Auth0 SDK mounts /auth/logout at the root, outside [locale], and
             * needs a full navigation so the proxy middleware can clear the
             * session cookie. Same pattern as src/components/nav-user.tsx.
             */
            /* eslint-disable-next-line @next/next/no-html-link-for-pages */
            <a
              href="/auth/logout"
              className="text-text-2 hover:text-text ml-auto text-sm tracking-tight"
            >
              {t("logOut")}
            </a>
          )}
        </div>
      </header>
      <div className="flex-1">{children}</div>
      <PublicFooter />
    </>
  );
}
