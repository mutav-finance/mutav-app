"use client";

import {
  LayoutDashboardIcon,
  FileTextIcon,
  ShieldCheckIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import { useWorkspace } from "@/providers/workspace";
import { NavAgency } from "@/components/nav-agency";
import { NavCadastros } from "@/components/nav-cadastros";
import { NavMain } from "@/components/nav-main";

export function AgencyNav() {
  const tMain = useTranslations("nav.main");
  const { selectedAgency } = useWorkspace();
  const cases = useQuery(
    api.delinquencies.useCases.listCases,
    selectedAgency ? { agencyId: selectedAgency._id, group: "needs_you" } : "skip",
  );

  const navMain = [
    { title: tMain("dashboard"), href: "/", icon: <LayoutDashboardIcon /> },
    { title: tMain("guarantees"), href: "/guarantees", icon: <FileTextIcon /> },
    {
      title: tMain("delinquencies"),
      href: "/claims",
      icon: <TriangleAlertIcon />,
      badge: cases?.counts.needs_you,
    },
    { title: tMain("transparency"), href: "/transparency", icon: <ShieldCheckIcon /> },
  ];

  return (
    <>
      <NavMain items={navMain} />
      <NavAgency />
      <NavCadastros />
    </>
  );
}
