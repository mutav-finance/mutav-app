"use client";

import { TooltipProvider } from "@mutav/ui/tooltip";
import { ConvexClientProvider } from "./convex";
import { WorkspaceProvider } from "./workspace";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ConvexClientProvider>
      <WorkspaceProvider>
        <TooltipProvider>{children}</TooltipProvider>
      </WorkspaceProvider>
    </ConvexClientProvider>
  );
}
