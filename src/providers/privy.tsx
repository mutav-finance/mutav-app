"use client";

import { PrivyProvider } from "@privy-io/react-auth";

const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;

export function PrivyClientProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!appId) return <>{children}</>;

  return (
    <PrivyProvider
      appId={appId}
      config={{
        appearance: {
          theme: "dark",
        },
        loginMethods: ["wallet", "email"],
        supportedChains: [], // TODO: configure Solana chain
      }}
    >
      {children}
    </PrivyProvider>
  );
}
