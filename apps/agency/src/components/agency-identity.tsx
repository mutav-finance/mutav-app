"use client";

import { NavUser } from "@mutav/ui/nav-user";
import { useWorkspace } from "@/providers/workspace";

export function AgencyIdentity() {
  const { currentUser } = useWorkspace();

  return <NavUser user={currentUser ?? { name: "…", email: "" }} />;
}
