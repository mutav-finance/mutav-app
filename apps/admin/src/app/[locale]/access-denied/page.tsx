import { LockIcon, LogInIcon, ShieldCheckIcon } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Button } from "@mutav/ui/button";
import { Eyebrow } from "@mutav/ui/eyebrow";
import { Mono } from "@mutav/ui/mono";
import { BareShell } from "@mutav/ui/shell/bare-shell";
import { Wordmark } from "@mutav/ui/wordmark";
import {
  type AccessDeniedTone,
  resolveAccessDeniedView,
} from "@/components/access-denied/view-model";
import { getStaffMember } from "@/lib/auth";
import { getAgencyUrl } from "@/lib/env";

const toneIcon: Record<AccessDeniedTone, typeof LockIcon> = {
  denied: LockIcon,
  signedOut: LogInIcon,
  granted: ShieldCheckIcon,
};

/**
 * Access-denied screen for the admin origin.
 *
 * Lives OUTSIDE the `(admin)` route group on purpose: that group's layout is
 * the staff gate, and a gate must not re-gate its own redirect target. Being
 * outside the gate also makes the route publicly reachable, so all three
 * session states are handled rather than assuming the non-staff one.
 *
 * Loop-freedom: a `staff` visitor is offered a link back to the console, never
 * a redirect. Redirecting would put this page and the `(admin)` gate in a
 * cycle if staff status ever flapped between the two reads.
 *
 * This is a terminal state, not a document, so it centers in the viewport and
 * skips the <PageShell>/<PageHeader> stack those primitives exist for.
 */
export default async function AccessDeniedPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "accessDenied" });

  const view = resolveAccessDeniedView({
    gate: await getStaffMember(),
    locale,
    agencyUrl: getAgencyUrl(),
  });
  const ToneIcon = toneIcon[view.tone];

  return (
    <BareShell brand={<Wordmark size="sm" />} dataFront="mutav-staff">
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

        {/* Both targets can be cross-origin or outside the `[locale]` tree,
              so plain <a> rather than the next-intl Link. */}
        <div className="mt-8 flex flex-wrap gap-2">
          <Button asChild>
            <a href={view.primary.href}>{t(view.primary.labelKey)}</a>
          </Button>
          <Button asChild variant="outline">
            <a href={view.secondary.href}>{t(view.secondary.labelKey)}</a>
          </Button>
        </div>

        {view.email ? (
          <p className="border-border text-text-3 mt-8 border-t pt-4 text-xs">
            {t.rich("signedInAs", {
              email: view.email,
              mono: (chunks) => <Mono className="text-text-2">{chunks}</Mono>,
            })}
          </p>
        ) : null}
      </div>
    </BareShell>
  );
}
