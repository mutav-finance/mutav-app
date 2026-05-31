"use client";

import { useTranslations } from "next-intl";
import { SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";

/**
 * Sidebar item that's been scoped but not yet shipped. Visually distinct
 * from `disabled` items (no harsh grey-out) so the sidebar reads like a
 * roadmap rather than a broken app — picks up `nav.roadmapBadge` for the
 * localized "em breve" / "soon" tag at the row's trailing edge.
 */
export function SidebarRoadmapItem({ icon, label }: { icon: React.ReactNode; label: string }) {
  const t = useTranslations("nav");
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        disabled
        tooltip={`${label} — ${t("roadmapBadge")}`}
        className="text-muted-foreground/80 cursor-default opacity-100"
      >
        {icon}
        <span>{label}</span>
        <span className="text-muted-foreground/60 ml-auto text-[0.6875rem] tracking-wide uppercase">
          {t("roadmapBadge")}
        </span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
