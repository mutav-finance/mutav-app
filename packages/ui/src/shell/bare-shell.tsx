import type { ReactNode } from "react";
import { PublicShell } from "@mutav/ui/public/public-shell";

export type BareShellProps = {
  /**
   * Brand lockup in a bordered top bar. Required, not optional: a terminal
   * state is where a user is most likely to doubt they are still on Mutav, and
   * an optional slot is a rule no gate can see — `admin/access-denied` shipped
   * without one for exactly that reason.
   */
  brand: ReactNode;
  dataFront: string;
  /** Merged onto the PublicShell root — lets a palette-forcing app pass `dark` for routes outside its themed group. */
  className?: string;
  children: ReactNode;
};

/**
 * Deliberately mounts no ThemeProvider and no Toaster: `admin/access-denied`
 * renders outside any ThemeProvider today, so adding one would change its
 * output for system-dark viewers. There is also no skip-link — there is no
 * nav to skip.
 */
export function BareShell({ brand, dataFront, className, children }: BareShellProps) {
  return (
    <PublicShell className={className}>
      <header className="border-border bg-canvas border-b">
        <div className="flex h-14 items-center px-4 lg:px-6">{brand}</div>
      </header>
      <main
        id="main-content"
        data-front={dataFront}
        className="flex min-h-0 flex-1 items-center justify-center px-6 py-16"
      >
        {children}
      </main>
    </PublicShell>
  );
}
