import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { PageContent } from "@/components/page/page-content";

type Props = {
  searchParams: Promise<{ state?: string }>;
};

export default async function OnboardingStatusPage({ searchParams }: Props) {
  const t = await getTranslations("onboarding.status");
  const { state } = await searchParams;

  const stateLabel = state === "under_review" ? t("stateUnderReview") : t("stateSubmitted");

  return (
    <PageContent variant="narrow" className="py-16 md:py-24">
      <div className="flex flex-col items-center gap-6 text-center">
        {/* Status indicator */}
        <div className="flex items-center gap-2">
          <span className="bg-accent size-2 rounded-full" aria-hidden />
          <span className="text-text-3 font-mono text-xs tracking-wide uppercase">
            {stateLabel}
          </span>
        </div>

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

        <Link
          href="/onboarding"
          className="text-text-3 hover:text-text mt-4 text-sm underline-offset-4 hover:underline"
        >
          {t("homeButton")}
        </Link>
      </div>
    </PageContent>
  );
}
