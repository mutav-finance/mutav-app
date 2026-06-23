"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ShieldCheckIcon, ShieldIcon, WalletIcon } from "lucide-react";
import { Button } from "@mutav/ui/button";
import { useWallet } from "@mutav/wallet/provider";

const truncate = (address: string) => `${address.slice(0, 4)}…${address.slice(-4)}`;

/**
 * Staff wallet control for the admin header. Each admin connects their own wallet
 * (Freighter — hardware-optional via Ledger — or xBull); that key is one signer
 * of the vault's M-of-N admin multisig (ADR 0005).
 *
 * "Verify ownership" signs a SEP-10-style challenge transaction and verifies the
 * signature against the connected address — proving the admin controls the key.
 * Client-side only here; binding the wallet to the staff identity (enrolling it
 * as a signer) is a server-verified step (see ownership.ts).
 */
export function ConnectWallet() {
  const t = useTranslations("wallet");
  const { address, connecting, error, connect, disconnect, proveOwnership } = useWallet();
  const [verifying, setVerifying] = useState(false);
  const [verified, setVerified] = useState(false);

  if (address) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-muted-foreground font-mono text-sm" title={address}>
          {truncate(address)}
        </span>
        <Button
          variant={verified ? "outline" : "default"}
          size="sm"
          disabled={verifying}
          onClick={async () => {
            setVerifying(true);
            setVerified(false);
            try {
              setVerified(await proveOwnership());
            } catch {
              // Rejected / wallet error — the wallet surfaces it; stay unverified.
            } finally {
              setVerifying(false);
            }
          }}
        >
          {verified ? <ShieldCheckIcon /> : <ShieldIcon />}
          {verified ? t("verified") : verifying ? t("verifying") : t("verify")}
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
