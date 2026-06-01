import { getTranslations } from "next-intl/server";
import { Mono } from "@mutav/ui/mono";

/**
 * Public payment portal header. TGA wordmark on the left, invoice public id
 * on the right (the agency user is the audience — they're paying their
 * own invoice, so the right-hand label confirms which one).
 */
export async function PublicHeader({ publicId }: { publicId: string }) {
  const t = await getTranslations("paymentFlow.shell");

  return (
    <header className="border-border bg-canvas border-b">
      <div className="flex h-14 items-center justify-between px-4 lg:px-6">
        <span
          className="font-display text-accent text-base font-bold tracking-tight"
          aria-label={t("brand")}
        >
          {t("brand")}
        </span>
        <span className="text-2xs text-text-2 flex items-center gap-2">
          <span className="font-sans tracking-[0.06em] uppercase">{t("paymentLabel")}</span>
          <Mono>{publicId}</Mono>
        </span>
      </div>
    </header>
  );
}
