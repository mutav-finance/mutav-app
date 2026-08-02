"use client";

import { useTranslations } from "next-intl";
import { Button } from "@mutav/ui/button";

/**
 * Fund's identity slot. Deliberately still disabled and provider-free:
 * wiring a real wallet needs `@mutav/wallet` in fund's deps and
 * transpilePackages, a provider, new env getters, and a CSP widening —
 * a security decision that does not ride along inside a shell refactor.
 */
export function ConnectWallet() {
  const t = useTranslations("wallet");

  return (
    <Button variant="outline" size="sm" disabled>
      {t("connect")}
    </Button>
  );
}
