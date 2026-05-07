"use client";

import { Button } from "@/components/ui/button";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { Link, usePathname } from "@/i18n/navigation";
import { CirclePlusIcon, MailIcon } from "lucide-react";
import { useTranslations } from "next-intl";

type NavMainItem = {
  title: string;
  href?: string;
  icon?: React.ReactNode;
};

export function NavMain({ items }: { items: NavMainItem[] }) {
  const t = useTranslations("nav.main");
  const pathname = usePathname();
  return (
    <SidebarGroup>
      <SidebarGroupContent className="flex flex-col gap-2">
        <SidebarMenu>
          <SidebarMenuItem className="flex items-center gap-2">
            <SidebarMenuButton
              tooltip={t("quickCreate")}
              className="bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground active:bg-primary/90 active:text-primary-foreground min-w-8 duration-200 ease-linear"
            >
              <CirclePlusIcon />
              <span>{t("quickCreate")}</span>
            </SidebarMenuButton>
            <Button
              size="icon"
              className="size-8 group-data-[collapsible=icon]:opacity-0"
              variant="outline"
            >
              <MailIcon />
              <span className="sr-only">{t("inbox")}</span>
            </Button>
          </SidebarMenuItem>
        </SidebarMenu>
        <SidebarMenu>
          {items.map((item) => {
            const isActive =
              item.href != null &&
              (item.href === "/"
                ? pathname === "/"
                : pathname === item.href || pathname.startsWith(`${item.href}/`));
            return (
              <SidebarMenuItem key={item.title}>
                {item.href ? (
                  <SidebarMenuButton asChild tooltip={item.title} isActive={isActive}>
                    <Link href={item.href}>
                      {item.icon}
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                ) : (
                  <SidebarMenuButton tooltip={item.title}>
                    {item.icon}
                    <span>{item.title}</span>
                  </SidebarMenuButton>
                )}
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
