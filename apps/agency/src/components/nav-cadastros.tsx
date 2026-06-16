"use client";

import { SidebarGroup, SidebarGroupLabel, SidebarMenu } from "@mutav/ui/sidebar";
import { SidebarRoadmapItem } from "@/components/sidebar-roadmap-item";
import { HomeIcon, UserRoundIcon, KeyRoundIcon } from "lucide-react";
import { useTranslations } from "next-intl";

/**
 * "Cadastros" — the Brazilian-real-estate term for the registry of
 * parties + assets a guarantee touches. All entries are roadmap until
 * the registry domain ships; rendering them as `SidebarRoadmapItem`
 * keeps the surface visible without screaming "broken".
 */
export function NavCadastros() {
  const t = useTranslations("nav.cadastros");

  return (
    <SidebarGroup className="group-data-[collapsible=icon]:hidden">
      <SidebarGroupLabel>{t("groupLabel")}</SidebarGroupLabel>
      <SidebarMenu>
        <SidebarRoadmapItem icon={<UserRoundIcon />} label={t("tenants")} />
        <SidebarRoadmapItem icon={<HomeIcon />} label={t("properties")} />
        <SidebarRoadmapItem icon={<KeyRoundIcon />} label={t("propertyOwners")} />
      </SidebarMenu>
    </SidebarGroup>
  );
}
