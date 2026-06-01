import { getTranslations } from "next-intl/server";
import { Link, redirect } from "@mutav/i18n/navigation";
import { PageContent } from "@mutav/ui/page/page-content";
import { Button } from "@mutav/ui/button";
import { resolveUserDestination } from "@/lib/user-destination";

type Props = {
  searchParams: Promise<{ reason?: string }>;
  params: Promise<{ locale: string }>;
};

export default async function OnboardingRejectedPage({ searchParams, params }: Props) {
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
  const { reason } = await searchParams;

  return (
    <PageContent variant="narrow" className="py-16 md:py-24">
      <div className="flex flex-col items-center gap-6">
        {/* Status pill — acima da moldura */}
        <div className="flex items-center gap-2">
          <span className="bg-error tga-live-square size-1.5" aria-hidden />
          <span className="text-text-3 font-mono text-xs tracking-wide uppercase">
            {t("title")}
          </span>
        </div>

        {/* Card com moldura e fundo error/5 */}
        <div className="border-border bg-error/5 flex w-full flex-col items-center gap-6 rounded border p-8 text-center md:p-12">
          <div className="flex flex-col gap-3">
            <h1 className="text-text text-2xl font-semibold">{t("title")}</h1>
            <p className="text-text-2 max-w-sm text-sm">{t("subtitle")}</p>
          </div>

          {/* Motivo da reprovação */}
          <div className="border-border bg-error/10 w-full max-w-sm rounded border p-4 text-center">
            <p className="text-text-3 mb-1.5 text-xs font-medium tracking-wide uppercase">
              {t("reasonLabel")}
            </p>
            <p className="text-text text-sm">
              {reason ? decodeURIComponent(reason) : t("noReason")}
            </p>
          </div>

          <p className="text-text-3 text-sm">
            {t("contactLabel")}{" "}
            <Link href="mailto:parceiros@mutav.com.br" className="text-accent underline">
              {t("contactLink")}
            </Link>
          </p>
        </div>

        {/* Botão abaixo da moldura */}
        <Button variant="outline" asChild>
          <Link href="/onboarding">{t("homeButton")}</Link>
        </Button>
      </div>
    </PageContent>
  );
}
