"use client";

import { Auth0Provider } from "@auth0/nextjs-auth0";
import { TooltipProvider } from "@mutav/ui/tooltip";
import { WalletProvider } from "@mutav/wallet/provider";
import { ConvexClientProvider } from "./convex";
import { getStellarNetwork, getStellarNetworkPassphrase, getStellarRpcUrl } from "@/lib/env";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <Auth0Provider>
      <ConvexClientProvider>
        <WalletProvider
          network={getStellarNetwork()}
          rpcUrl={getStellarRpcUrl()}
          networkPassphrase={getStellarNetworkPassphrase()}
          // Staff surface: never silently inherit an auto-restored wallet
          // session — require an explicit connect each page-load (ADR 0005).
          persistSession={false}
          // Connecting a staff wallet immediately proves ownership (signs a
          // challenge) — one gesture, no half-connected state.
          verifyOwnershipOnConnect
        >
          <TooltipProvider>{children}</TooltipProvider>
        </WalletProvider>
      </ConvexClientProvider>
    </Auth0Provider>
  );
}
