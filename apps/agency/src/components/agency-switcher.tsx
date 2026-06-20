"use client";

import * as React from "react";
import { ChevronsUpDownIcon, BuildingIcon, CheckIcon } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@mutav/ui/dropdown-menu";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "@mutav/ui/sidebar";
import { useWorkspace } from "@/providers/workspace";
import { cn } from "@mutav/ui/cn";

const ROLE_LABEL: Record<string, string> = {
  owner: "Proprietário",
  admin: "Admin",
  member: "Membro",
};

export function AgencySwitcher() {
  const { isMobile } = useSidebar();
  const { agencies, selectedAgency, setSelectedAgency, isLoading } = useWorkspace();

  if (isLoading || !selectedAgency) {
    return (
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton size="lg" disabled className="animate-pulse">
            <div className="bg-sidebar-primary text-sidebar-primary-foreground flex aspect-square size-8 items-center justify-center rounded-lg">
              <BuildingIcon className="size-4" />
            </div>
            <div className="grid flex-1 gap-1">
              <div className="bg-muted h-3 w-24 rounded" />
              <div className="bg-muted h-2 w-16 rounded" />
            </div>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    );
  }

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <div className="bg-sidebar-primary text-sidebar-primary-foreground flex aspect-square size-8 items-center justify-center rounded-lg">
                <BuildingIcon className="size-4" />
              </div>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-semibold">{selectedAgency.name}</span>
                <span className="text-muted-foreground truncate text-xs">
                  {ROLE_LABEL[selectedAgency.role] ?? selectedAgency.role}
                </span>
              </div>
              <ChevronsUpDownIcon className="ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-(--radix-dropdown-menu-trigger-width) min-w-56 rounded-lg"
            align="start"
            side={isMobile ? "bottom" : "right"}
            sideOffset={4}
          >
            <DropdownMenuLabel className="text-muted-foreground text-xs">
              Workspaces
            </DropdownMenuLabel>
            {agencies.map((agency) => (
              <DropdownMenuItem
                key={agency._id}
                onClick={() => setSelectedAgency(agency._id)}
                className="gap-2 p-2"
              >
                <div className="flex size-6 items-center justify-center rounded-sm border">
                  <BuildingIcon className="size-3.5 shrink-0" />
                </div>
                <div className="grid flex-1 text-sm leading-tight">
                  <span className="truncate font-medium">{agency.name}</span>
                  <span className="text-muted-foreground truncate text-xs">
                    {ROLE_LABEL[agency.role] ?? agency.role}
                  </span>
                </div>
                <CheckIcon
                  className={cn(
                    "ml-auto size-4",
                    agency._id === selectedAgency._id ? "opacity-100" : "opacity-0",
                  )}
                />
              </DropdownMenuItem>
            ))}
            {agencies.length > 1 && <DropdownMenuSeparator />}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
