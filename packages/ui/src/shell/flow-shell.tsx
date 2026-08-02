import type { ReactNode } from "react";
import { PublicShell } from "@mutav/ui/public/public-shell";
import { Toaster } from "@mutav/ui/sonner";

export type FlowShellProps = {
  /** Brand lockup. The app supplies the wrapper so a locale-aware link and its accessible name stay in app code. */
  brand: ReactNode;
  /** Right-side non-identity chip (e.g. the invoice public id). Never routed through `identity`. */
  context?: ReactNode;
  /** Right-side identity / escape hatch. Optional — the shell never reaches for a session itself. */
  identity?: ReactNode;
  /** Bottom bar. Required, so the shell owns no app-specific footer namespace. */
  footer: ReactNode;
  dataFront: string;
  /** Pre-translated skip-link label. A package must not own an app's message namespace. */
  skipToMainLabel: string;
  children: ReactNode;
};

export function FlowShell({
  brand,
  context,
  identity,
  footer,
  dataFront,
  skipToMainLabel,
  children,
}: FlowShellProps) {
  return (
    <PublicShell>
      <a href="#main-content" className="skip-link">
        {skipToMainLabel}
      </a>
      <header className="border-border bg-canvas border-b">
        <div className="flex h-14 items-center justify-between px-4 lg:px-6">
          {brand}
          {/* Always rendered: an empty flex row has zero width, so the DOM shape stays branch-free across consumers. */}
          <div className="flex items-center gap-4">
            {context}
            {identity}
          </div>
        </div>
      </header>
      <main id="main-content" data-front={dataFront} className="flex min-h-0 flex-1 flex-col">
        {children}
      </main>
      {footer}
      <Toaster />
    </PublicShell>
  );
}
