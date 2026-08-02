import type { CSSProperties, ReactNode } from "react";
import { Separator } from "@mutav/ui/separator";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@mutav/ui/sidebar";
import { Toaster } from "@mutav/ui/sonner";
import { ThemeProvider } from "@mutav/ui/theme";

export type AppShellProps = {
  /** Fills `<SidebarHeader>` — brand block, workspace switcher, whatever the app puts there. */
  sidebarHeader: ReactNode;
  /** Fills `<SidebarContent>`. Nav item definitions stay app-local and arrive already composed. */
  nav: ReactNode;
  /** Fills `<SidebarFooter>`. The identity slot — each app derives it its own way (client hook vs server session). */
  identity: ReactNode;
  /** Rendered raw after the header separator. No wrapper is supplied: consumers carry their own `ml-auto`. */
  headerEnd?: ReactNode;
  /** Persona marker on `<main>`. Cannot be inferred inside the package. */
  dataFront: string;
  /** Pre-translated skip-link label. A package must not own an app's message namespace. */
  skipToMainLabel: string;
  children: ReactNode;
};

// AppShell owns both custom properties — no app's globals.css declares them,
// and `h-(--header-height)` / `w-(--sidebar-width)` collapse silently when unset.
const SHELL_CSS_VARS: CSSProperties & Record<`--${string}`, string> = {
  "--sidebar-width": "calc(var(--spacing) * 72)",
  "--header-height": "calc(var(--spacing) * 12)",
};

export function AppShell({
  sidebarHeader,
  nav,
  identity,
  headerEnd,
  dataFront,
  skipToMainLabel,
  children,
}: AppShellProps) {
  return (
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem disableTransitionOnChange>
      <SidebarProvider className="h-svh overflow-hidden" style={SHELL_CSS_VARS}>
        <a href="#main-content" className="skip-link">
          {skipToMainLabel}
        </a>
        <Sidebar collapsible="offcanvas" variant="inset">
          <SidebarHeader>{sidebarHeader}</SidebarHeader>
          <SidebarContent>{nav}</SidebarContent>
          <SidebarFooter>{identity}</SidebarFooter>
        </Sidebar>
        <SidebarInset className="min-h-0">
          <header className="flex h-(--header-height) shrink-0 items-center gap-2 border-b transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-(--header-height)">
            <div className="flex w-full items-center gap-1 px-4 lg:gap-2 lg:px-6">
              <SidebarTrigger className="-ml-1" />
              <Separator orientation="vertical" className="mx-2 data-[orientation=vertical]:h-4" />
              {headerEnd}
            </div>
          </header>
          <main
            id="main-content"
            data-front={dataFront}
            className="@container/main flex min-h-0 flex-1 flex-col overflow-y-auto"
          >
            {children}
          </main>
        </SidebarInset>
        <Toaster />
      </SidebarProvider>
    </ThemeProvider>
  );
}
