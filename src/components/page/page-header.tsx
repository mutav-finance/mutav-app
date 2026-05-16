import * as React from "react";
import { cn } from "@/lib/utils";

type Variant = "section" | "hero";
type Width = "full" | "narrow" | "wide";

/**
 * Page header with title + optional subtitle / breadcrumb / actions.
 *
 * - `variant="section"` (default, `text-xl`) — list/dashboard pages
 * - `variant="hero"` (`text-3xl`) — detail pages with a single primary subject
 * - `width="narrow"` aligns with <PageContent variant="narrow"> below it
 * - `width="wide"` aligns with <PageContent variant="wide"> below it
 */
export function PageHeader({
  title,
  subtitle,
  variant = "section",
  width = "full",
  breadcrumb,
  actions,
  className,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  variant?: Variant;
  width?: Width;
  breadcrumb?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  const titleClass =
    variant === "hero"
      ? "font-display text-foreground text-3xl font-bold tracking-tight"
      : "font-display text-foreground text-xl font-bold tracking-tight";

  return (
    <header
      className={cn(
        "flex flex-col gap-2 px-4 lg:px-6",
        width === "narrow" && "mx-auto w-full max-w-(--page-content-max-width)",
        width === "wide" && "mx-auto w-full max-w-(--page-wide-max-width)",
        className,
      )}
    >
      {breadcrumb}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className={titleClass}>{title}</h1>
          {subtitle && <p className="text-base-sm text-muted-foreground">{subtitle}</p>}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}
