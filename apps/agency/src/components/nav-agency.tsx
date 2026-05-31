"use client";

import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { SidebarRoadmapItem } from "@/components/sidebar-roadmap-item";
import { UsersIcon, BuildingIcon, BadgeDollarSignIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";

export function NavAgency() {
  const t = useTranslations("nav.agency");
  const pathname = usePathname();

  return (
    <SidebarGroup>
      <SidebarGroupLabel>{t("groupLabel")}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          <SidebarRoadmapItem icon={<UsersIcon />} label={t("members")} />
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              tooltip={t("commission")}
              isActive={pathname === "/commission"}
            >
              <Link href="/commission">
                <BadgeDollarSignIcon />
                <span>{t("commission")}</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarRoadmapItem icon={<BuildingIcon />} label={t("agencySettings")} />
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
