import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { PageContent } from "@/components/page/page-content";
import { Button } from "@/components/ui/button";

type Props = {
  searchParams: Promise<{ state?: string }>;
};

export default async function OnboardingStatusPage({ searchParams }: Props) {
  const t = await getTranslations("onboarding.status");
  const { state } = await searchParams;

  const stateLabel = state === "under_review" ? t("stateUnderReview") : t("stateSubmitted");

  return (
    <PageContent variant="narrow" className="py-16 md:py-24">
      <div className="flex flex-col items-center gap-6">
        {/* Status pill — acima da moldura */}
        <div className="flex items-center gap-2">
          <span className="bg-accent tga-live-square size-1.5" aria-hidden />
          <span className="text-text-3 font-mono text-xs tracking-wide uppercase">
            {stateLabel}
          </span>
        </div>

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
