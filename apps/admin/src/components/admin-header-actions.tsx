"use client";

import { useLocale, useTranslations } from "next-intl";
import { ArrowLeftIcon } from "lucide-react";
import { Button } from "@mutav/ui/button";
import { buildCrossAppUrl } from "@mutav/i18n/cross-app";
import { getAgencyUrl } from "@/lib/env";
import { ConnectWallet } from "@/components/wallet/connect-wallet";

/**
 * Stays app-local rather than moving into @mutav/ui: it reads `@/lib/env` and
 * `@mutav/wallet`, and pulling the wallet kit into the shared package would
 * force it (and its CSP requirements) onto agency, fund, and pay.
 */
export function AdminHeaderActions() {
  const locale = useLocale();
  const t = useTranslations("shellSwitcher");
  // Cross-origin absolute URL — plain <a>, not the same-origin next-intl Link.
  const href = buildCrossAppUrl(getAgencyUrl(), locale);

  return (
    <div className="ml-auto flex items-center gap-2">
      <ConnectWallet />
      <Button asChild variant="ghost" size="sm">
        <a href={href}>
          <ArrowLeftIcon />
          {t("backToAgency")}
        </a>
      </Button>
    </div>
  );
}
