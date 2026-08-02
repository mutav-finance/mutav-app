import { getTranslations } from "next-intl/server";
import { Mono } from "@mutav/ui/mono";

/**
 * Right-hand header chip confirming which invoice is being paid. A context
 * label, not an identity — pay's identity slot stays empty for every viewer.
 */
export async function InvoiceChip({ publicId }: { publicId: string }) {
  const t = await getTranslations("paymentFlow.shell");

  return (
    <span className="text-2xs text-text-2 flex items-center gap-2">
      <span className="font-sans tracking-[0.06em] uppercase">{t("paymentLabel")}</span>
      <Mono>{publicId}</Mono>
    </span>
  );
}
