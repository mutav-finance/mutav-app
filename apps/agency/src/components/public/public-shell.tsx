import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Outer shell for the `(public)` route group. Scrollable column inside the
 * viewport-locked root <body>. Follows the user's theme (light or dark) —
 * the QR container is the only element pinned to white to stay scannable.
 */
export function PublicShell({ className, children, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn("bg-canvas text-text flex h-full flex-1 flex-col overflow-y-auto", className)}
      {...props}
    >
      {children}
    </div>
  );
}
