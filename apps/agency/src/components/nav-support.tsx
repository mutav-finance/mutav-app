"use client";

import { LifeBuoyIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { SidebarGroup, SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@mutav/ui/sidebar";
import { PARTNER_SUPPORT_EMAIL } from "@/lib/support";

export function NavSupport() {
  const t = useTranslations("nav");

  return (
    <SidebarGroup className="mt-auto">
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton asChild size="lg" tooltip={PARTNER_SUPPORT_EMAIL}>
            <a href={`mailto:${PARTNER_SUPPORT_EMAIL}`}>
              <LifeBuoyIcon />
              <span className="flex flex-col leading-tight">
                <span>{t("support")}</span>
                <span className="text-muted-foreground text-xs">{PARTNER_SUPPORT_EMAIL}</span>
              </span>
            </a>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    </SidebarGroup>
  );
}
