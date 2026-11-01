import { ImageResponse } from "next/og";
import { hasLocale } from "next-intl";
import { getTranslations } from "next-intl/server";
import { LINK_PREVIEW_SIZE, LinkPreviewCard } from "@mutav/brand/link-preview-card";
import { routing } from "@mutav/i18n/routing";

export const alt = "MUTAV";
export const size = LINK_PREVIEW_SIZE;
export const contentType = "image/png";

// Static per locale: every route below inherits this card, so it must never
// read a child segment's params.
export default async function OpenGraphImage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: requested } = await params;
  const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale;
  const t = await getTranslations({ locale, namespace: "meta" });

  return new ImageResponse(<LinkPreviewCard descriptor={t("descriptor")} />, { ...size });
}
