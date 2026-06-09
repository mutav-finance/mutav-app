"use client";

import { Auth0Provider } from "@auth0/nextjs-auth0";
import { TooltipProvider } from "@mutav/ui/tooltip";
import { ConvexClientProvider } from "./convex";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <Auth0Provider>
      <ConvexClientProvider>
        <TooltipProvider>{children}</TooltipProvider>
      </ConvexClientProvider>
    </Auth0Provider>
  );
}
