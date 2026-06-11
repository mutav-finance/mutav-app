"use client";

import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@mutav/ui/sidebar";
import { Link, usePathname } from "@mutav/i18n/navigation";
import { CirclePlusIcon } from "lucide-react";
import { useTranslations } from "next-intl";

type NavMainItem = {
  title: string;
  href: string;
  icon?: React.ReactNode;
};

export function NavMain({ items }: { items: NavMainItem[] }) {
  const t = useTranslations("nav.main");
  const pathname = usePathname();
  return (
    <SidebarGroup>
      <SidebarGroupContent className="flex flex-col gap-2">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              tooltip={t("createContract")}
              className="bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground active:bg-primary/90 active:text-primary-foreground"
            >
              <Link href="/contracts/new">
                <CirclePlusIcon />
                <span>{t("createContract")}</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <SidebarMenu>
          {items.map((item) => {
            const isActive =
              item.href === "/"
                ? pathname === "/"
                : pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <SidebarMenuItem key={item.title}>
                <SidebarMenuButton asChild tooltip={item.title} isActive={isActive}>
                  <Link href={item.href}>
                    {item.icon}
                    <span>{item.title}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
