"use client";

import * as React from "react";

import { NavMain } from "@/components/nav-main";
import { NavUser } from "@mutav/ui/nav-user";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import {
  LayoutDashboardIcon,
  BuildingIcon,
  ShieldCheckIcon,
  AlertOctagonIcon,
  CoinsIcon,
  ActivityIcon,
  ScaleIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";

type AdminUser = {
  name: string;
  email: string;
  avatar?: string;
};

export function AppSidebar({
  user,
  ...props
}: React.ComponentProps<typeof Sidebar> & { user: AdminUser }) {
  const tMain = useTranslations("nav.main");

  const navMain = [
    { title: tMain("overview"), href: "/", icon: <LayoutDashboardIcon /> },
    { title: tMain("agencies"), href: "/agencies", icon: <BuildingIcon /> },
    { title: tMain("compliance"), href: "/compliance", icon: <ShieldCheckIcon /> },
    { title: tMain("defaults"), href: "/defaults", icon: <AlertOctagonIcon /> },
    { title: tMain("treasury"), href: "/treasury", icon: <CoinsIcon /> },
    { title: tMain("observability"), href: "/observability", icon: <ActivityIcon /> },
    { title: tMain("nav"), href: "/nav", icon: <ScaleIcon /> },
  ];

  return (
    <Sidebar collapsible="offcanvas" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" className="pointer-events-none">
              <div className="bg-sidebar-primary text-sidebar-primary-foreground flex aspect-square size-8 items-center justify-center rounded-lg">
                <ShieldCheckIcon className="size-4" />
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-semibold">Mutav Admin</span>
                <span className="text-muted-foreground truncate text-xs">Staff console</span>
              </div>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={navMain} />
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={user} />
      </SidebarFooter>
    </Sidebar>
  );
}
