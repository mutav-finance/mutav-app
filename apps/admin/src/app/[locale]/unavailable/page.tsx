import { CloudOffIcon } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Link } from "@mutav/i18n/navigation";
import { Button } from "@mutav/ui/button";
import { Eyebrow } from "@mutav/ui/eyebrow";
import { BareShell } from "@mutav/ui/shell/bare-shell";
import { Wordmark } from "@mutav/ui/wordmark";

/**
 * Terminal page for a signed-in user whose staff status could not be read
 * (the `(admin)` gate returned `unavailable`).
 *
 * Lives OUTSIDE the `(admin)` route group on purpose: that group's layout is
 * the staff gate, and a gate must not re-gate its own redirect target.
 *
 * Loop-freedom: this page never calls `getStaffMember` and never redirects.
 * "Try again" is a user-initiated link back to the console; sending this
 * failure to `/auth/login` instead would complete silently via SSO, fail the
 * same read again, and loop through Auth0.
 */
export default async function UnavailablePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "unavailable" });

  return (
    <BareShell brand={<Wordmark size="sm" />} dataFront="mutav-staff">
      <div className="motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 w-full max-w-lg motion-safe:duration-500">
        <div className="border-border bg-accent-dim text-accent flex size-11 items-center justify-center border">
          <CloudOffIcon className="size-5" strokeWidth={1.75} aria-hidden />
        </div>

        <Eyebrow tone="subtle" className="mt-6 block uppercase">
          {t("eyebrow")}
        </Eyebrow>

        <h1 className="font-display text-text mt-2 text-3xl font-bold tracking-tight text-balance">
          {t("title")}
        </h1>

        <p className="text-text-2 mt-3 text-base text-pretty">{t("subtitle")}</p>

        <div className="mt-8 flex flex-wrap gap-2">
          <Button asChild>
            <Link href="/">{t("tryAgain")}</Link>
          </Button>
          <Button asChild variant="outline">
            {/* The Auth0 SDK mounts /auth/logout at the root, outside [locale],
                and needs a full navigation so the proxy can clear the session
                cookie — a plain <a>, never next/link. */}
            {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
            <a href="/auth/logout">{t("logOut")}</a>
          </Button>
        </div>
      </div>
    </BareShell>
  );
}
