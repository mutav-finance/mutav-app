import { getTranslations } from "next-intl/server";
import { Button } from "@mutav/ui/button";
import { Card, CardContent } from "@mutav/ui/card";
import { PageContent } from "@mutav/ui/page/page-content";
import { PageHeader } from "@mutav/ui/page/page-header";
import { PageShell } from "@mutav/ui/page/page-shell";
import { PublicShell } from "@mutav/ui/public/public-shell";
import { resolveAccessDeniedView } from "@/components/access-denied/view-model";
import { getStaffMember } from "@/lib/auth";
import { getAgencyUrl } from "@/lib/env";

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

  return (
    <PublicShell>
      <main id="main-content" data-front="mutav-staff" className="flex min-h-0 flex-1 flex-col">
        <PageShell>
          <PageHeader
            variant="hero"
            width="narrow"
            title={t(view.titleKey)}
            subtitle={t(view.subtitleKey)}
          />
          <PageContent variant="narrow">
            <Card>
              <CardContent className="flex flex-col gap-4">
                {/* Both targets can be cross-origin or outside the `[locale]`
                    tree, so plain <a> rather than the next-intl Link. */}
                <div className="flex flex-wrap gap-2">
                  <Button asChild>
                    <a href={view.primary.href}>{t(view.primary.labelKey)}</a>
                  </Button>
                  <Button asChild variant="outline">
                    <a href={view.secondary.href}>{t(view.secondary.labelKey)}</a>
                  </Button>
                </div>
                {view.email ? (
                  <p className="text-muted-foreground text-sm">
                    {t("signedInAs", { email: view.email })}
                  </p>
                ) : null}
              </CardContent>
            </Card>
          </PageContent>
        </PageShell>
      </main>
    </PublicShell>
  );
}
