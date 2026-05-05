"use client";

import { TooltipProvider } from "@/components/ui/tooltip";
import { ConvexClientProvider } from "./convex";
import { StellarProvider } from "./stellar";
import { ThemeProvider } from "./theme";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="light"
      enableSystem
      disableTransitionOnChange
    >
      <ConvexClientProvider>
        <StellarProvider>
          <TooltipProvider>{children}</TooltipProvider>
        </StellarProvider>
      </ConvexClientProvider>
    </ThemeProvider>
  );
}
