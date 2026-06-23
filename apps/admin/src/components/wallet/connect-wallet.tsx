"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { CheckIcon, PenLineIcon, WalletIcon } from "lucide-react";
import { Button } from "@mutav/ui/button";
import { useWallet } from "@mutav/wallet/provider";

const truncate = (address: string) => `${address.slice(0, 4)}…${address.slice(-4)}`;

/**
 * Staff wallet control for the admin header. Each admin connects their own wallet
 * (Freighter — hardware-optional via Ledger — or xBull); that key is one signer
 * of the vault's M-of-N admin multisig (ADR 0005).
 *
 * The "Sign (test)" action signs a throwaway SEP-53 message (no transaction, no
 * fee) — it prompts the wallet so the signing path can be verified before any
 * on-chain operation (cover_default) is wired.
 */
export function ConnectWallet() {
  const t = useTranslations("wallet");
  const { address, connecting, error, connect, disconnect, signMessage } = useWallet();
  const [signing, setSigning] = useState(false);
  const [signed, setSigned] = useState(false);

  if (address) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground font-mono text-sm" title={address}>
          {truncate(address)}
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={signing}
          onClick={async () => {
            setSigning(true);
            setSigned(false);
            try {
              await signMessage(`Mutav Admin · teste de assinatura · ${new Date().toISOString()}`);
              setSigned(true);
            } catch {
              // Rejected / wallet error — the wallet surfaces it; leave un-signed.
            } finally {
              setSigning(false);
            }
          }}
        >
          {signed ? <CheckIcon /> : <PenLineIcon />}
          {signed ? t("signed") : signing ? t("signing") : t("sign")}
        </Button>
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
