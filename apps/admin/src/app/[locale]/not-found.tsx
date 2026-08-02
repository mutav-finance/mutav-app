import { getTranslations } from "next-intl/server";
import { Button } from "@mutav/ui/button";
import { Eyebrow } from "@mutav/ui/eyebrow";
import { Link } from "@mutav/i18n/navigation";
import { BareShell } from "@mutav/ui/shell/bare-shell";
import { Wordmark } from "@mutav/ui/wordmark";

export default async function NotFound() {
  const t = await getTranslations("notFound");

  return (
    <BareShell brand={<Wordmark size="sm" />} dataFront="mutav-staff">
      <div className="w-full max-w-lg">
        <Eyebrow tone="subtle" className="block uppercase">
          {t("eyebrow")}
        </Eyebrow>
        <h1 className="font-display text-text mt-2 text-3xl font-bold tracking-tight text-balance">
          {t("title")}
        </h1>
        <p className="text-text-2 mt-3 text-base text-pretty">{t("subtitle")}</p>
        <div className="mt-8">
          <Button asChild>
            <Link href="/">{t("backLabel")}</Link>
          </Button>
        </div>
      </div>
    </BareShell>
  );
}
