import { getTranslations } from "next-intl/server";
import { Eyebrow } from "@mutav/ui/eyebrow";
import { BareShell } from "@mutav/ui/shell/bare-shell";
import { Wordmark } from "@mutav/ui/wordmark";

/**
 * No action button, unlike the other three 404s: every pay URL is a
 * `publicId` bearer link, so there is no valid same-origin destination to
 * offer — a link to "/" would 404 again. The subtitle carries the instruction.
 */
export default async function NotFound() {
  const t = await getTranslations("notFound");

  return (
    <BareShell brand={<Wordmark variant="display" size="md" />} dataFront="imobiliarias">
      <div className="w-full max-w-lg">
        <Eyebrow tone="subtle" className="block uppercase">
          {t("eyebrow")}
        </Eyebrow>
        <h1 className="font-display text-text mt-2 text-3xl font-bold tracking-tight text-balance">
          {t("title")}
        </h1>
        <p className="text-text-2 mt-3 text-base text-pretty">{t("subtitle")}</p>
      </div>
    </BareShell>
  );
}
