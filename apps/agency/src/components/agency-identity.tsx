"use client";

import { NavUser } from "@mutav/ui/nav-user";
import { getLogoutHref } from "@/lib/logout";
import { useWorkspace } from "@/providers/workspace";

export function AgencyIdentity() {
  const { currentUser } = useWorkspace();

  return (
    <NavUser user={currentUser ?? { name: "…", email: "" }} logoutHref={getLogoutHref()} />
  );
}
