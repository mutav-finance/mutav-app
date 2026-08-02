import { getTranslations } from "next-intl/server";
import { Link } from "@mutav/i18n/navigation";
import { PublicFooter } from "@mutav/ui/public/public-footer";
import { FlowShell } from "@mutav/ui/shell/flow-shell";
import { Wordmark } from "@mutav/ui/wordmark";
import { auth0 } from "@/lib/auth0";

export default async function OnboardingLayout({ children }: { children: React.ReactNode }) {
  const session = await auth0.getSession();
  const t = await getTranslations("userMenu");
  const tA11y = await getTranslations("common.a11y");

  return (
    <FlowShell
      brand={
        <Link href="/onboarding" aria-label="MUTAV">
          <Wordmark size="sm" />
        </Link>
      }
      identity={
        session ? (
          /*
           * Auth0 SDK mounts /auth/logout at the root, outside [locale], and
           * needs a full navigation so the proxy middleware can clear the
           * session cookie. Same pattern as @mutav/ui's nav-user.
           */
          /* eslint-disable-next-line @next/next/no-html-link-for-pages */
          <a href="/auth/logout" className="text-text-2 hover:text-text text-sm tracking-tight">
            {t("logOut")}
          </a>
        ) : null
      }
      footer={<PublicFooter />}
      dataFront="imobiliarias"
      skipToMainLabel={tA11y("skipToMain")}
    >
      {children}
    </FlowShell>
  );
}
