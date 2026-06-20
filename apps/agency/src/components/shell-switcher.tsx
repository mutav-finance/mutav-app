"use client";

import { useQuery } from "convex/react";
import { useLocale, useTranslations } from "next-intl";
import { ShieldCheckIcon } from "lucide-react";
import { api } from "@convex/_generated/api";
import { Button } from "@mutav/ui/button";
import { buildCrossAppUrl } from "@mutav/i18n/cross-app";
import { getAdminUrl } from "@/lib/env";

/**
 * Agency → admin cross-link, visible only to staff. A non-SSR identity
 * island: `useQuery` (not preloaded) is correct because visibility flips on
 * auth state. Renders nothing while loading (undefined) or for non-staff.
 */
export function ShellSwitcher() {
  const isStaff = useQuery(api.mutavStaff.useCases.amIStaff);
  const locale = useLocale();
  const t = useTranslations("shellSwitcher");

  if (isStaff !== true) return null;

  // Cross-origin absolute URL — plain <a>, not the same-origin next-intl Link.
  const href = buildCrossAppUrl(getAdminUrl(), locale);

  return (
    <Button asChild variant="ghost" size="sm" className="ml-auto">
      <a href={href}>
        <ShieldCheckIcon />
        {t("toAdmin")}
      </a>
    </Button>
  );
}
