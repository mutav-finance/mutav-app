import * as React from "react";
import { cn } from "@/lib/utils";

type Variant = "full" | "narrow" | "wide";

/**
 * Page content area with width policy.
 *
 * - `variant="full"` (default) — no max-width, no horizontal padding;
 *   children manage their own (`px-4 lg:px-6`). For tables, dashboards,
 *   and other full-bleed-aware components.
 * - `variant="narrow"` — `mx-auto max-w-(--page-content-max-width)` (4xl)
 *   with `px-4 lg:px-6`. For cards, forms, prose, detail pages.
 * - `variant="wide"` — `mx-auto max-w-(--page-wide-max-width)` (screen-2xl)
 *   with `px-4 lg:px-6`. For wide tables that should still cap on
 *   ultra-wide screens.
 */
export function PageContent({
  variant = "full",
  className,
  children,
  ...props
}: React.ComponentProps<"div"> & { variant?: Variant }) {
  return (
    <div
      className={cn(
        "flex flex-col gap-4 md:gap-6",
        variant === "narrow" && "mx-auto w-full max-w-(--page-content-max-width) px-4 lg:px-6",
        variant === "wide" && "mx-auto w-full max-w-(--page-wide-max-width) px-4 lg:px-6",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}
