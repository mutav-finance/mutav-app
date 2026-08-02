"use client";

import {
  LayoutDashboardIcon,
  BuildingIcon,
  ShieldCheckIcon,
  AlertOctagonIcon,
  CoinsIcon,
  ActivityIcon,
  ScaleIcon,
  UsersIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { NavMain } from "@/components/nav-main";

export function AdminNav() {
  const tMain = useTranslations("nav.main");

  const navMain = [
    { title: tMain("overview"), href: "/", icon: <LayoutDashboardIcon /> },
    { title: tMain("agencies"), href: "/agencies", icon: <BuildingIcon /> },
    { title: tMain("compliance"), href: "/compliance", icon: <ShieldCheckIcon /> },
    { title: tMain("defaults"), href: "/defaults", icon: <AlertOctagonIcon /> },
    { title: tMain("treasury"), href: "/treasury", icon: <CoinsIcon /> },
    { title: tMain("observability"), href: "/observability", icon: <ActivityIcon /> },
    { title: tMain("nav"), href: "/nav", icon: <ScaleIcon /> },
    { title: tMain("staff"), href: "/staff", icon: <UsersIcon /> },
  ];

  return <NavMain items={navMain} />;
}
