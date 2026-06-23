"use client";

import { useTranslations } from "next-intl";
import { WalletIcon } from "lucide-react";
import { Button } from "@mutav/ui/button";
import { useWallet } from "@mutav/wallet/provider";

const truncate = (address: string) => `${address.slice(0, 4)}…${address.slice(-4)}`;

/**
 * Staff wallet connect control for the admin header. Each admin connects their
 * own wallet (Freighter — hardware-optional via Ledger — or xBull); that key is
 * one signer on the vault's M-of-N admin multisig (ADR 0005). Connection only
 * surfaces the address; signing happens per-operation via `makeSignTransaction`.
 */
export function ConnectWallet() {
  const t = useTranslations("wallet");
  const { address, connecting, error, connect, disconnect } = useWallet();

  if (address) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground font-mono text-sm" title={address}>
          {truncate(address)}
        </span>
        <Button variant="ghost" size="sm" onClick={disconnect}>
          {t("disconnect")}
        </Button>
      </div>
    );
  }

  return (
    <Button
      size="sm"
      disabled={connecting}
      onClick={() => void connect().catch(() => {})}
      title={error ?? undefined}
    >
      <WalletIcon />
      {connecting ? t("connecting") : t("connect")}
    </Button>
  );
}
