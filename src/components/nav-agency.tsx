"use client";

import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { UsersIcon, BuildingIcon } from "lucide-react";
import { useTranslations } from "next-intl";

export function NavAgency() {
  const t = useTranslations("nav.agency");

  const items = [
    { key: "members", icon: <UsersIcon /> },
    { key: "agencySettings", icon: <BuildingIcon /> },
  ] as const;

  return (
    <SidebarGroup>
      <SidebarGroupLabel>{t("groupLabel")}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) => (
            <SidebarMenuItem key={item.key}>
              <SidebarMenuButton
                tooltip={t(item.key)}
                disabled
                className="cursor-not-allowed opacity-40"
              >
                {item.icon}
                <span>{t(item.key)}</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
