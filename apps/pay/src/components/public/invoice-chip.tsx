import { getTranslations } from "next-intl/server";
import { Mono } from "@mutav/ui/mono";

/**
 * Right-hand header chip confirming which invoice is being paid. A context
 * label, not an identity — pay's identity slot stays empty for every viewer.
 *
 * Takes the invoice's `INV-…` document number, never the URL segment: that
 * segment is the bearer credential and must never be rendered (LGPD-25).
 */
export async function InvoiceChip({ documentNumber }: { documentNumber: string }) {
  const t = await getTranslations("paymentFlow.shell");

  return (
    <span className="text-2xs text-text-2 flex items-center gap-2">
      <span className="font-sans tracking-[0.06em] uppercase">{t("paymentLabel")}</span>
      <Mono>{documentNumber}</Mono>
    </span>
  );
}
