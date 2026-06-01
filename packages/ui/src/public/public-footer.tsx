import { getTranslations } from "next-intl/server";

export async function PublicFooter() {
  const t = await getTranslations("paymentFlow.shell");
  return (
    <footer className="border-border bg-canvas border-t">
      <div className="text-2xs text-text-2 flex h-12 items-center px-4 tracking-[0.06em] uppercase lg:px-6">
        {t("footerBrand")}
      </div>
    </footer>
  );
}
