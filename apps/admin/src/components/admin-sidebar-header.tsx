"use client";

import { ShieldCheckIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@mutav/ui/sidebar";

export function AdminSidebarHeader() {
  const t = useTranslations("nav.brand");

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        {/* Brand block — non-interactive label, intentionally not a link.
            Agency renders an AgencySwitcher here; staff have no analogous
            workspace to switch between. */}
        <SidebarMenuButton size="lg" className="pointer-events-none">
          <div className="bg-sidebar-primary text-sidebar-primary-foreground flex aspect-square size-8 items-center justify-center rounded-lg">
            <ShieldCheckIcon className="size-4" />
          </div>
          <div className="grid flex-1 text-left text-sm leading-tight">
            <span className="truncate font-semibold">{t("title")}</span>
            <span className="text-muted-foreground truncate text-xs">{t("subtitle")}</span>
          </div>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
