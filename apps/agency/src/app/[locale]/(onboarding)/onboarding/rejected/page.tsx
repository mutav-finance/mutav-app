import { getTranslations } from "next-intl/server";
import { Link, redirect } from "@mutav/i18n/navigation";
import { PageContent } from "@mutav/ui/page/page-content";
import { StatusTag } from "@mutav/ui/status-tag";
import { ResubmitButton } from "@/components/onboarding/resubmit-button";
import { fetchMyOnboardingStatus } from "@/lib/onboarding";
import { resolveUserDestination } from "@/lib/user-destination";

type Props = {
  params: Promise<{ locale: string }>;
};

export default async function OnboardingRejectedPage({ params }: Props) {
  const { locale } = await params;
  const dest = await resolveUserDestination();

  if (dest.kind === "dashboard") {
    redirect({ href: "/", locale });
  }
  if (dest.kind === "onboarding-welcome") {
    redirect({ href: "/onboarding", locale });
  }
  if (dest.kind === "onboarding-status") {
    redirect({ href: `/onboarding/status?state=${dest.state}`, locale });
  }

  const t = await getTranslations("onboarding.rejected");
  // The reason comes from the server, never from the URL — a query-string
  // reason would let anyone craft a page that puts words in Mutav's mouth.
  const status = await fetchMyOnboardingStatus();
  const reason = status?.state === "rejected" ? status.rejectionReason : null;
  const agencyId = status?.state === "rejected" ? status.agencyId : null;

  return (
    <PageContent variant="narrow" className="py-16 md:py-24">
      <div className="flex flex-col items-center gap-6">
        <StatusTag tone="critical" pulse>
          {t("title")}
        </StatusTag>

        <div className="border-border bg-error/5 flex w-full flex-col items-center gap-6 rounded border p-8 text-center md:p-12">
          <div className="flex flex-col gap-3">
            <h1 className="text-text text-2xl font-semibold">{t("title")}</h1>
            <p className="text-text-2 max-w-sm text-sm">{t("subtitle")}</p>
          </div>

          <div className="border-border bg-error/10 w-full max-w-sm rounded border p-4 text-center">
            <p className="text-text-3 mb-1.5 text-xs font-medium tracking-wide uppercase">
              {t("reasonLabel")}
            </p>
            <p className="text-text text-sm whitespace-pre-line">{reason ?? t("noReason")}</p>
          </div>

          <p className="text-text-2 max-w-sm text-sm">{t("resubmitHint")}</p>

          <p className="text-text-3 text-sm">
            {t("contactLabel")}{" "}
            <Link href="mailto:parceiros@mutav.com.br" className="text-accent underline">
              {t("contactLink")}
            </Link>
          </p>
        </div>

        {agencyId && <ResubmitButton agencyId={agencyId} />}
      </div>
    </PageContent>
  );
}
