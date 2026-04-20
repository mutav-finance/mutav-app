"use client";

import { StellarWalletsKit } from "@creit.tech/stellar-wallets-kit";
import { createContext, useContext, useMemo } from "react";

const StellarContext = createContext<StellarWalletsKit | null>(null);

export function useStellarWallet() {
  const kit = useContext(StellarContext);
  if (!kit) throw new Error("useStellarWallet must be used within StellarProvider");
  return kit;
}

export function StellarProvider({ children }: { children: React.ReactNode }) {
  const kit = useMemo(() => new StellarWalletsKit(), []);

  return (
    <StellarContext.Provider value={kit}>{children}</StellarContext.Provider>
  );
}
