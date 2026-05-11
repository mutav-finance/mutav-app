"use client";

import * as React from "react";

import { NavDocuments } from "@/components/nav-documents";
import { NavMain } from "@/components/nav-main";
import { NavSecondary } from "@/components/nav-secondary";
import { NavUser } from "@/components/nav-user";
import { NavAgency } from "@/components/nav-agency";
import { AgencySwitcher } from "@/components/agency-switcher";
import { Sidebar, SidebarContent, SidebarFooter, SidebarHeader } from "@/components/ui/sidebar";
import {
  LayoutDashboardIcon,
  ChartBarIcon,
  Settings2Icon,
  CircleHelpIcon,
  FileTextIcon,
  ReceiptIcon,
  HomeIcon,
  UserRoundIcon,
  CalendarClockIcon,
  ShieldCheckIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useWorkspace } from "@/providers/workspace";

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const tMain = useTranslations("nav.main");
  const tSecondary = useTranslations("nav.secondary");
  const tDocs = useTranslations("nav.documents");
  const { currentUser } = useWorkspace();

  const navMain = [
    { title: tMain("dashboard"), href: "/", icon: <LayoutDashboardIcon /> },
    { title: tMain("contracts"), href: "/contracts", icon: <FileTextIcon /> },
    { title: tMain("payments"), href: "/payments", icon: <ReceiptIcon /> },
    { title: tMain("lifecycle"), icon: <CalendarClockIcon />, disabled: true },
    { title: tMain("reports"), icon: <ChartBarIcon />, disabled: true },
  ];
  const navSecondary = [
    { title: tSecondary("settings"), url: "#", icon: <Settings2Icon /> },
    { title: tSecondary("getHelp"), url: "#", icon: <CircleHelpIcon /> },
  ];
  const documents = [
    { name: tDocs("tenants"), url: "#", icon: <UserRoundIcon /> },
    { name: tDocs("properties"), url: "#", icon: <HomeIcon /> },
    { name: tDocs("contractTemplates"), url: "#", icon: <FileTextIcon /> },
    { name: tDocs("guaranteePolicies"), url: "#", icon: <ShieldCheckIcon /> },
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
        <NavDocuments items={documents} />
        <NavAgency />
        <NavSecondary items={navSecondary} className="mt-auto" />
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={currentUser ?? { name: "…", email: "" }} />
      </SidebarFooter>
    </Sidebar>
  );
}
