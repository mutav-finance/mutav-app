"use client";

import { TooltipProvider } from "@/components/ui/tooltip";
import { ConvexClientProvider } from "./convex";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ConvexClientProvider>
      <TooltipProvider>{children}</TooltipProvider>
    </ConvexClientProvider>
  );
}
