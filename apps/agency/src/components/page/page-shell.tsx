import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Outermost page wrapper. Provides the project's vertical rhythm
 * (`gap-4 md:gap-6`, `py-4 md:py-6`) and `@container/main` at the
 * mid-level wrapper — required for `data-table.tsx` (`@4xl/main:`)
 * and `section-cards.tsx` (`@xl/main:`, `@5xl/main:`) responsive queries.
 *
 * Always wraps the entire page; pair with <PageHeader /> and <PageContent />.
 */
export function PageShell({ className, children, ...props }: React.ComponentProps<"div">) {
  return (
    <div className={cn("flex flex-1 flex-col", className)} {...props}>
      <div className="@container/main flex flex-1 flex-col gap-2">
        <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6">{children}</div>
      </div>
    </div>
  );
}
