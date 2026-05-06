"use client"

import * as React from "react"

import { NavDocuments } from "@/components/nav-documents"
import { NavMain } from "@/components/nav-main"
import { NavSecondary } from "@/components/nav-secondary"
import { NavUser } from "@/components/nav-user"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar"
import { LayoutDashboardIcon, ListIcon, ChartBarIcon, FolderIcon, UsersIcon, Settings2Icon, CircleHelpIcon, SearchIcon, DatabaseIcon, FileChartColumnIcon, FileIcon, CommandIcon, FileTextIcon } from "lucide-react"
import { useTranslations } from "next-intl"

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  const tBrand = useTranslations("brand")
  const tMain = useTranslations("nav.main")
  const tSecondary = useTranslations("nav.secondary")
  const tDocs = useTranslations("nav.documents")

  const navMain = [
    { title: tMain("dashboard"), href: "/", icon: <LayoutDashboardIcon /> },
    { title: tMain("contracts"), href: "/contracts/1000001", icon: <FileTextIcon /> },
    { title: tMain("lifecycle"), icon: <ListIcon /> },
    { title: tMain("analytics"), icon: <ChartBarIcon /> },
    { title: tMain("projects"), icon: <FolderIcon /> },
    { title: tMain("team"), icon: <UsersIcon /> },
  ]
  const navSecondary = [
    { title: tSecondary("settings"), url: "#", icon: <Settings2Icon /> },
    { title: tSecondary("getHelp"), url: "#", icon: <CircleHelpIcon /> },
    { title: tSecondary("search"), url: "#", icon: <SearchIcon /> },
  ]
  const documents = [
    { name: tDocs("dataLibrary"), url: "#", icon: <DatabaseIcon /> },
    { name: tDocs("reports"), url: "#", icon: <FileChartColumnIcon /> },
    { name: tDocs("wordAssistant"), url: "#", icon: <FileIcon /> },
  ]
  const user = {
    name: "shadcn",
    email: "m@example.com",
    avatar: "/avatars/shadcn.jpg",
  }

  return (
    <Sidebar collapsible="offcanvas" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              className="data-[slot=sidebar-menu-button]:p-1.5!"
            >
              <a href="#">
                <CommandIcon className="size-5!" />
                <span className="text-base font-semibold">{tBrand("name")}</span>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={navMain} />
        <NavDocuments items={documents} />
        <NavSecondary items={navSecondary} className="mt-auto" />
      </SidebarContent>
      <SidebarFooter>
        <NavUser user={user} />
      </SidebarFooter>
    </Sidebar>
  )
}
