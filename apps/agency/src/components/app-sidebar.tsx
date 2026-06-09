"use client";

import * as React from "react";

import { NavCadastros } from "@/components/nav-cadastros";
import { NavMain } from "@/components/nav-main";
import { NavUser } from "@/components/nav-user";
import { NavAgency } from "@/components/nav-agency";
import { AgencySwitcher } from "@/components/agency-switcher";
import { Sidebar, SidebarContent, SidebarFooter, SidebarHeader } from "@/components/ui/sidebar";
import {
  LayoutDashboardIcon,
  FileTextIcon,
  HeartPulseIcon,
  ReceiptIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useWorkspace } from "@/providers/workspace";

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const tMain = useTranslations("nav.main");
  const { currentUser } = useWorkspace();

  const navMain = [
    { title: tMain("dashboard"), href: "/", icon: <LayoutDashboardIcon /> },
    { title: tMain("contracts"), href: "/contracts", icon: <FileTextIcon /> },
    { title: tMain("payments"), href: "/payments", icon: <ReceiptIcon /> },
    { title: tMain("delinquencies"), href: "/delinquencies", icon: <TriangleAlertIcon /> },
    { title: tMain("health"), href: "/health", icon: <HeartPulseIcon /> },
  ];

  return (
    <Sidebar collapsible="offcanvas" {...props}>
      <SidebarHeader>
        <div className="px-2 pt-2 pb-1">
          <span className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
            MUTAV Garantias
          </span>
        </div>
        <AgencySwitcher />
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={navMain} />
        <NavAgency />
        <NavCadastros />
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={currentUser ?? { name: "…", email: "" }} />
      </SidebarFooter>
    </Sidebar>
  );
}
