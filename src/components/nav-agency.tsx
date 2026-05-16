"use client";

import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { UsersIcon, BuildingIcon, BadgeDollarSignIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";

const items = [
  { key: "members", href: null, icon: <UsersIcon /> },
  { key: "commission", href: "/commission", icon: <BadgeDollarSignIcon /> },
  { key: "agencySettings", href: null, icon: <BuildingIcon /> },
] as const;

export function NavAgency() {
  const t = useTranslations("nav.agency");
  const pathname = usePathname();

  return (
    <SidebarGroup>
      <SidebarGroupLabel>{t("groupLabel")}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((item) =>
            item.href ? (
              <SidebarMenuItem key={item.key}>
                <SidebarMenuButton asChild tooltip={t(item.key)} isActive={pathname === item.href}>
                  <Link href={item.href}>
                    {item.icon}
                    <span>{t(item.key)}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ) : (
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
            ),
          )}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
