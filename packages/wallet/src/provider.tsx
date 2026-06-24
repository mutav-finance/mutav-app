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
import {
  connect as kitConnect,
  disconnect as kitDisconnect,
  restore as kitRestore,
} from "./session";
import { signAndSubmit as kitSignAndSubmit, signMessage as kitSignMessage } from "./signer";
import { proveOwnership as kitProveOwnership } from "./ownership";

export interface WalletContextValue {
  /** Connected Stellar public key, or null. */
  address: string | null;
  /** True iff the connected wallet proved ownership (signed-challenge verified). */
  verified: boolean;
  /** True while a connect/disconnect is in flight. */
  connecting: boolean;
  /** Last connect error message, or null. */
  error: string | null;
  /** Open the wallet picker and connect. */
  connect(): Promise<void>;
  /** Disconnect the active wallet. */
  disconnect(): void;
  /** Sign an arbitrary message (SEP-53); returns the signature. No tx/fee. */
  signMessage(message: string): Promise<string>;
  /**
   * Prove control of the connected wallet via a signed challenge tx and verify
   * the signature against the address. Returns true iff verified. Client-side
   * only — not a server trust boundary (see ownership.ts).
   */
  proveOwnership(): Promise<boolean>;
  /** Sign + submit a raw XDR; returns the confirmed tx hash. */
  signAndSubmit(xdr: string): Promise<string>;
}

const WalletContext = createContext<WalletContextValue | null>(null);

export type WalletProviderProps = {
  network: WalletNetwork;
  rpcUrl: string;
  networkPassphrase: string;
  /**
   * Whether to reflect the kit's auto-restored session across reloads.
   * - `true` (default): on mount, reconcile React state with the kit's restored
   *   session (investor surfaces — keeps the user connected across reloads).
   * - `false`: clear any restored session on mount so connecting is always an
   *   explicit gesture (high-security surfaces like admin). The kit otherwise
   *   silently keeps a live, signable session that the UI wouldn't show.
   */
  persistSession?: boolean;
  /**
   * When true, `connect()` immediately proves ownership: after the wallet is
   * picked it signs a challenge transaction and verifies the signature, all as
   * one gesture. If the proof fails or is rejected, the connection is rolled
   * back (no half-connected state). High-security surfaces (admin) set this.
   */
  verifyOwnershipOnConnect?: boolean;
  children: ReactNode;
};

export function WalletProvider({
  network,
  rpcUrl,
  networkPassphrase,
  persistSession = true,
  verifyOwnershipOnConnect = false,
  children,
}: WalletProviderProps) {
  const [address, setAddress] = useState<string | null>(null);
  const [verified, setVerified] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    initWalletKit(network);
    if (persistSession) {
      // Reconcile React state with the kit's (possibly auto-restored) session.
      // No cancelled-flag guard: network/persistSession are static per surface
      // (never change at runtime), and a post-unmount setState is a no-op in
      // React 19. setState stays inside the async callback (not synchronous in
      // the effect) per react-hooks/set-state-in-effect.
      void kitRestore().then((addr) => {
        if (addr) setAddress(addr);
      });
    } else {
      // Never silently inherit an auto-restored live session on this surface —
      // clear it so the kit and UI agree that nothing is connected until the
      // user explicitly connects.
      void kitDisconnect();
    }
  }, [network, persistSession]);

  const connect = useCallback(async () => {
    setConnecting(true);
    try {
      const addr = await kitConnect(network);
      // Use the fresh address (state hasn't committed yet this tick).
      if (verifyOwnershipOnConnect) {
        const ok = await kitProveOwnership(addr, networkPassphrase);
        if (!ok) {
          await kitDisconnect();
          throw new Error("wallet ownership could not be verified");
        }
        setVerified(true);
      }
      setAddress(addr);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      throw err;
    } finally {
      setConnecting(false);
    }
  }, [network, verifyOwnershipOnConnect, networkPassphrase]);

  const disconnect = useCallback(() => {
    // Clear UI state only after the kit has actually torn down its session, so
    // the UI never reports "disconnected" while a live kit session lingers.
    void kitDisconnect().finally(() => {
      setAddress(null);
      setVerified(false);
    });
  }, []);

  const signMessage = useCallback(
    async (message: string) => {
      const { signedMessage } = await kitSignMessage(message, networkPassphrase, address);
      return signedMessage;
    },
    [networkPassphrase, address],
  );

  const proveOwnership = useCallback(async () => {
    if (!address) throw new Error("wallet not connected");
    const ok = await kitProveOwnership(address, networkPassphrase);
    setVerified(ok);
    return ok;
  }, [address, networkPassphrase]);

  const signAndSubmit = useCallback(
    (xdr: string) => kitSignAndSubmit(xdr, { rpcUrl, networkPassphrase, address }),
    [rpcUrl, networkPassphrase, address],
  );

  return (
    <WalletContext.Provider
      value={{
        address,
        verified,
        connecting,
        error,
        connect,
        disconnect,
        signMessage,
        proveOwnership,
        signAndSubmit,
      }}
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
