"use client";

import { useLocale, useTranslations } from "next-intl";
import { ArrowLeftIcon } from "lucide-react";
import { Separator } from "@mutav/ui/separator";
import { SidebarTrigger } from "@mutav/ui/sidebar";
import { Button } from "@mutav/ui/button";
import { buildCrossAppUrl } from "@mutav/i18n/cross-app";
import { getAgencyUrl } from "@/lib/env";
import { ConnectWallet } from "@/components/wallet/connect-wallet";

export function SiteHeader() {
  const locale = useLocale();
  const t = useTranslations("shellSwitcher");
  // Cross-origin absolute URL — plain <a>, not the same-origin next-intl Link.
  const href = buildCrossAppUrl(getAgencyUrl(), locale);

  return (
    <header className="flex h-(--header-height) shrink-0 items-center gap-2 border-b transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-(--header-height)">
      <div className="flex w-full items-center gap-1 px-4 lg:gap-2 lg:px-6">
        <SidebarTrigger className="-ml-1" />
        <Separator orientation="vertical" className="mx-2 data-[orientation=vertical]:h-4" />
        <div className="ml-auto flex items-center gap-2">
          <ConnectWallet />
          <Button asChild variant="ghost" size="sm">
            <a href={href}>
              <ArrowLeftIcon />
              {t("backToAgency")}
            </a>
          </Button>
        </div>
      </div>
    </header>
  );
}
