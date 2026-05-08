import { getTranslations } from "next-intl/server";
import { AppSidebar } from "@/components/app-sidebar";
import { SiteHeader } from "@/components/site-header";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const tA11y = await getTranslations("common.a11y");

  return (
    <SidebarProvider
      className="h-svh overflow-hidden"
      style={
        {
          "--sidebar-width": "calc(var(--spacing) * 72)",
          "--header-height": "calc(var(--spacing) * 12)",
        } as React.CSSProperties
      }
    >
      <a href="#main-content" className="skip-link">
        {tA11y("skipToMain")}
      </a>
      <AppSidebar variant="inset" />
      <SidebarInset className="min-h-0">
        <SiteHeader />
        <main
          id="main-content"
          data-front="imobiliarias"
          className="flex min-h-0 flex-1 flex-col overflow-auto"
        >
          {children}
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
