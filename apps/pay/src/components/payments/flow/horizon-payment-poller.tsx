"use client";

import { useTranslations } from "next-intl";

export function HorizonPaymentPoller() {
  const t = useTranslations("paymentFlow.address");

  return (
    <div className="text-text-2 flex items-center gap-2 text-sm" role="status">
      <span aria-hidden="true" className="tga-live-square bg-accent inline-block size-1.5" />
      <span className="font-sans">{t("pollerLabel")}</span>
    </div>
  );
}
