"use client";

import { PrivyClientProvider } from "./privy";
import { ConvexClientProvider } from "./convex";
import { StellarProvider } from "./stellar";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <PrivyClientProvider>
      <ConvexClientProvider>
        <StellarProvider>{children}</StellarProvider>
      </ConvexClientProvider>
    </PrivyClientProvider>
  );
}
