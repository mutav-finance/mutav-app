"use client";

import {
  LayoutDashboardIcon,
  FileTextIcon,
  ShieldCheckIcon,
  ReceiptIcon,
  TriangleAlertIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { NavAgency } from "@/components/nav-agency";
import { NavCadastros } from "@/components/nav-cadastros";
import { NavMain } from "@/components/nav-main";

export function AgencyNav() {
  const tMain = useTranslations("nav.main");

  const navMain = [
    { title: tMain("dashboard"), href: "/", icon: <LayoutDashboardIcon /> },
    { title: tMain("contracts"), href: "/contracts", icon: <FileTextIcon /> },
    { title: tMain("invoices"), href: "/invoices", icon: <ReceiptIcon /> },
    { title: tMain("delinquencies"), href: "/delinquencies", icon: <TriangleAlertIcon /> },
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
