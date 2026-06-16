import { getTranslations } from "next-intl/server";
import { ClockIcon } from "lucide-react";
import { Link, redirect } from "@mutav/i18n/navigation";
import { PageContent } from "@mutav/ui/page/page-content";
import { Button } from "@mutav/ui/button";
import { StatusTag } from "@mutav/ui/status-tag";
import { resolveUserDestination } from "@/lib/user-destination";

type Props = {
  searchParams: Promise<{ state?: string }>;
  params: Promise<{ locale: string }>;
};

export default async function OnboardingStatusPage({ searchParams, params }: Props) {
  const { locale } = await params;
  const dest = await resolveUserDestination();

  if (dest.kind === "dashboard") {
    redirect({ href: "/", locale });
  }
  if (dest.kind === "onboarding-welcome") {
    redirect({ href: "/onboarding", locale });
  }
  if (dest.kind === "onboarding-rejected") {
    redirect({ href: "/onboarding/rejected", locale });
  }

  const t = await getTranslations("onboarding.status");
  const { state } = await searchParams;

  const stateLabel = state === "under_review" ? t("stateUnderReview") : t("stateSubmitted");

  return (
    <PageContent variant="narrow" className="py-16 md:py-24">
      <div className="flex flex-col items-center gap-6">
        {/* Status pill — acima da moldura. neutral + Clock icon communicates
            "in progress, no action required" per brand decision (no --info token). */}
        <StatusTag tone="neutral" pulse icon={<ClockIcon className="size-3.5" />}>
          {stateLabel}
        </StatusTag>

        {/* Card com moldura e fundo accent/5 */}
        <div className="border-border bg-accent/5 flex w-full flex-col items-center gap-6 rounded border p-8 text-center md:p-12">
          <div className="flex flex-col gap-3">
            <h1 className="text-text text-2xl font-semibold">{t("title")}</h1>
            <p className="text-text-2 max-w-sm text-sm">{t("subtitle")}</p>
          </div>

          <p className="text-text-3 text-sm">
            {t("backLabel")}{" "}
            <Link href="mailto:parceiros@mutav.com.br" className="text-accent underline">
              {t("backLink")}
            </Link>
          </p>
        </div>

        {/* Botão abaixo da moldura — aponta para a Landing Page (a criar) */}
        <Button variant="outline" asChild>
          <Link href="/onboarding">{t("homeButton")}</Link>
        </Button>
      </div>
    </PageContent>
  );
}
