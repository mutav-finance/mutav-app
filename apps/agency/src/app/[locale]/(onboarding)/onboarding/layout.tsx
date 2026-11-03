import { getTranslations } from "next-intl/server";
import { Link } from "@mutav/i18n/navigation";
import { PublicFooter } from "@mutav/ui/public/public-footer";
import { FlowShell } from "@mutav/ui/shell/flow-shell";
import { Wordmark } from "@mutav/ui/wordmark";
import { ShellSwitcher } from "@/components/shell-switcher";
import { auth0 } from "@/lib/auth0";
import { getLogoutHref } from "@/lib/logout";

export default async function OnboardingLayout({ children }: { children: React.ReactNode }) {
  const session = await auth0.getSession();
  const t = await getTranslations("userMenu");
  const tA11y = await getTranslations("common.a11y");
  const email = session?.user.email?.trim() ?? "";

  return (
    <FlowShell
      brand={
        <Link href="/onboarding">
          <Wordmark size="sm" />
        </Link>
      }
      identity={
        session ? (
          <div className="flex items-center gap-3 text-sm tracking-tight">
            {/* Staff land here too when they have no agency; this is their way to admin. */}
            <ShellSwitcher />
            {email ? <span className="text-text-2 font-mono">{email}</span> : null}
            {/* The logout route lives outside [locale] and needs a full navigation. */}
            <a href={getLogoutHref()} className="text-text-2 hover:text-text">
              {t("logOut")}
            </a>
          </div>
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
