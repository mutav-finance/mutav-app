"use client";

/**
 * provider.tsx — wallet React context.
 *
 * The consuming app wraps its tree in <WalletProvider> and passes the Stellar
 * network config (packages never read process.env). `useWallet()` exposes
 * connection state + actions. For Soroban contract bindings, prefer
 * `makeSignTransaction()` from `@mutav/wallet/signer`.
 */
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { initWalletKit, type WalletNetwork } from "./kit";
import { connect as kitConnect, disconnect as kitDisconnect } from "./session";
import { signAndSubmit as kitSignAndSubmit } from "./signer";

export interface WalletContextValue {
  /** Connected Stellar public key, or null. */
  address: string | null;
  /** True while a connect/disconnect is in flight. */
  connecting: boolean;
  /** Last connect error message, or null. */
  error: string | null;
  /** Open the wallet picker and connect. */
  connect(): Promise<void>;
  /** Disconnect the active wallet. */
  disconnect(): void;
  /** Sign + submit a raw XDR; returns the confirmed tx hash. */
  signAndSubmit(xdr: string): Promise<string>;
}

const WalletContext = createContext<WalletContextValue | null>(null);

export type WalletProviderProps = {
  network: WalletNetwork;
  rpcUrl: string;
  networkPassphrase: string;
  children: ReactNode;
};

export function WalletProvider({
  network,
  rpcUrl,
  networkPassphrase,
  children,
}: WalletProviderProps) {
  const [address, setAddress] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    initWalletKit(network);
  }, [network]);

  const connect = useCallback(async () => {
    setConnecting(true);
    try {
      const addr = await kitConnect(network);
      setAddress(addr);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      throw err;
    } finally {
      setConnecting(false);
    }
  }, [network]);

  const disconnect = useCallback(() => {
    kitDisconnect().catch((err) => {
      console.error("[@mutav/wallet] disconnect error:", err);
    });
    setAddress(null);
  }, []);

  const signAndSubmit = useCallback(
    (xdr: string) => kitSignAndSubmit(xdr, { rpcUrl, networkPassphrase, address }),
    [rpcUrl, networkPassphrase, address],
  );

  return (
    <WalletContext.Provider
      value={{ address, connecting, error, connect, disconnect, signAndSubmit }}
    >
      {children}
    </WalletContext.Provider>
  );
}

/** Access wallet state + actions. Must be inside <WalletProvider>. */
export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) {
    throw new Error("useWallet must be used inside <WalletProvider>");
  }
  return ctx;
}
