"use client";

import { TooltipProvider } from "@/components/ui/tooltip";
import { ConvexClientProvider } from "./convex";
import { ThemeProvider } from "./theme";
import { WorkspaceProvider } from "./workspace";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem disableTransitionOnChange>
      <ConvexClientProvider>
        <WorkspaceProvider>
          <TooltipProvider>{children}</TooltipProvider>
        </WorkspaceProvider>
      </ConvexClientProvider>
    </ThemeProvider>
  );
}
