"use client";

import { useTranslations } from "next-intl";
import { AgencySwitcher } from "@/components/agency-switcher";

export function AgencySidebarHeader() {
  const t = useTranslations("nav");

  return (
    <>
      <div className="px-2 pt-2 pb-1">
        <span className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
          {t("brandEyebrow")}
        </span>
      </div>
      <AgencySwitcher />
    </>
  );
}
