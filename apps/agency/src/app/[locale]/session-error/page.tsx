import { CloudOffIcon, Link2OffIcon, MailWarningIcon, UserRoundXIcon } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Link } from "@mutav/i18n/navigation";
import { Button } from "@mutav/ui/button";
import { Eyebrow } from "@mutav/ui/eyebrow";
import { BareShell } from "@mutav/ui/shell/bare-shell";
import { Wordmark } from "@mutav/ui/wordmark";
import {
  parseSessionErrorReason,
  resolveSessionErrorView,
  type SessionErrorTone,
} from "@/components/session-error/view-model";

const toneIcon: Record<SessionErrorTone, typeof CloudOffIcon> = {
  notProvisioned: UserRoundXIcon,
  backendUnavailable: CloudOffIcon,
  emailNotVerified: MailWarningIcon,
  emailBound: Link2OffIcon,
};

/**
 * Terminal page for a signed-in user whose destination could not be resolved:
 * the `users` row could not be provisioned (with the refusal reason when there
 * is one: unverified email, email bound to another sign-in), or the backend is
 * unavailable.
 *
 * Lives OUTSIDE the `(app)` and `(onboarding)` route groups on purpose: their
 * guards redirect here, and a guard must not re-gate its own redirect target.
 *
 * Loop-freedom: this page never calls `resolveUserDestination` and never
 * redirects. "Try again" is a user-initiated link back to `/`; sending these
 * failures to `/auth/login` automatically would complete silently via SSO,
 * fail the same read again, and loop through Auth0. The unverified-email
 * reason is the one exception, and still only on a click: the user goes back
 * through `/auth/login` because only a fresh ID token carries the newly
 * confirmed `email_verified`.
 */
export default async function SessionErrorPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ reason?: string | string[] }>;
}) {
  const { locale } = await params;
  const { reason } = await searchParams;
  const t = await getTranslations({ locale, namespace: "sessionError" });

  const view = resolveSessionErrorView(parseSessionErrorReason(reason));
  const ToneIcon = toneIcon[view.tone];

  return (
    <BareShell brand={<Wordmark size="sm" />} dataFront="imobiliarias">
      <div className="motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 w-full max-w-lg motion-safe:duration-500">
        <div className="border-border bg-accent-dim text-accent flex size-11 items-center justify-center border">
          <ToneIcon className="size-5" strokeWidth={1.75} aria-hidden />
        </div>

        <Eyebrow tone="subtle" className="mt-6 block uppercase">
          {t(view.eyebrowKey)}
        </Eyebrow>

        <h1 className="font-display text-text mt-2 text-3xl font-bold tracking-tight text-balance">
          {t(view.titleKey)}
        </h1>

        <p className="text-text-2 mt-3 text-base text-pretty">{t(view.subtitleKey)}</p>

        <div className="mt-8 flex flex-wrap gap-2">
          <Button asChild>
            {view.primaryAction.kind === "relogin" ? (
              // The Auth0 SDK mounts /auth/login at the root, outside [locale],
              // and needs a full navigation — a plain <a>, never next/link.
              <a href={view.primaryAction.href}>{t(view.primaryAction.labelKey)}</a>
            ) : (
              <Link href={view.primaryAction.href}>{t(view.primaryAction.labelKey)}</Link>
            )}
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
