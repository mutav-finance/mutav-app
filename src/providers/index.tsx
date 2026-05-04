"use client";

import { TooltipProvider } from "@/components/ui/tooltip";
import { ConvexClientProvider } from "./convex";
import { StellarProvider } from "./stellar";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ConvexClientProvider>
      <StellarProvider>
        <TooltipProvider>{children}</TooltipProvider>
      </StellarProvider>
    </ConvexClientProvider>
  );
}
