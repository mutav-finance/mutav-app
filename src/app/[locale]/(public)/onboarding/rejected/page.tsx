import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";
import { PageContent } from "@/components/page/page-content";

type Props = {
  searchParams: Promise<{ reason?: string }>;
};

export default async function OnboardingRejectedPage({ searchParams }: Props) {
  const t = await getTranslations("onboarding.rejected");
  const { reason } = await searchParams;

  return (
    <PageContent variant="narrow" className="py-16 md:py-24">
      <div className="flex flex-col items-center gap-6 text-center">
        {/* Status indicator */}
        <div className="flex items-center gap-2">
          <span className="bg-error size-2 rounded-full" aria-hidden />
          <span className="text-text-3 font-mono text-xs tracking-wide uppercase">
            {t("title")}
          </span>
        </div>

        <div className="flex flex-col gap-3">
          <h1 className="text-text text-2xl font-semibold">{t("title")}</h1>
          <p className="text-text-2 max-w-sm text-sm">{t("subtitle")}</p>
        </div>

        {/* Rejection reason from the admin review */}
        <div className="border-border w-full max-w-sm rounded border p-4 text-left">
          <p className="text-text-3 mb-1.5 text-xs font-medium tracking-wide uppercase">
            {t("reasonLabel")}
          </p>
          <p className="text-text text-sm">{reason ? decodeURIComponent(reason) : t("noReason")}</p>
        </div>

        <p className="text-text-3 text-sm">
          {t("contactLabel")}{" "}
          <Link href="mailto:parceiros@mutav.com.br" className="text-accent underline">
            {t("contactLink")}
          </Link>
        </p>

        <Link
          href="/onboarding"
          className="text-text-3 hover:text-text mt-2 text-sm underline-offset-4 hover:underline"
        >
          {t("homeButton")}
        </Link>
      </div>
    </PageContent>
  );
}
