"use client";

import { useTranslations } from "next-intl";
import { ShieldCheckIcon, WalletIcon } from "lucide-react";
import { Button } from "@mutav/ui/button";
import { useWallet } from "@mutav/wallet/provider";

const truncate = (address: string) => `${address.slice(0, 4)}…${address.slice(-4)}`;

/**
 * Staff wallet control for the admin header. Each admin connects their own wallet
 * (Freighter — hardware-optional via Ledger — or xBull); that key is one signer
 * of the vault's M-of-N admin multisig (ADR 0005).
 *
 * Connecting proves ownership in the same gesture: the provider has
 * `verifyOwnershipOnConnect`, so picking the wallet immediately signs a
 * SEP-10-style challenge and verifies the signature — no separate step, no
 * half-connected state. (Client-side verify; the server-side wallet↔staff
 * binding that enrolls a signer is the next increment — see ownership.ts.)
 */
export function ConnectWallet() {
  const t = useTranslations("wallet");
  const { address, verified, connecting, error, connect, disconnect } = useWallet();

  if (address) {
    return (
      <div className="flex items-center gap-2">
        {verified ? (
          <ShieldCheckIcon className="size-4 text-green-600" aria-label={t("verified")} />
        ) : null}
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
