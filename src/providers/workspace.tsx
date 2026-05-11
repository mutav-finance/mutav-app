"use client";

/**
 * WorkspaceContext — dev-shortcut implementation.
 *
 * Loads agencies for a hardcoded "dev-user" (publicId: "dev-user") and stores
 * the selected agencyId in localStorage.  When real auth is wired up, swap
 * `DEV_USER_PUBLIC_ID` for the authenticated user's publicId from the session.
 */

import * as React from "react";
import { useQuery } from "convex/react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";

const DEV_USER_PUBLIC_ID = "dev-user";
const STORAGE_KEY = "sgr:selectedAgencyId";

export type WorkspaceAgency = {
  _id: Id<"agencies">;
  name: string;
  cnpj: string;
  createdAt: string;
  role: "owner" | "admin" | "member";
};

export type WorkspaceUser = {
  name: string;
  email: string;
};

type WorkspaceContextValue = {
  /** The currently authenticated user. */
  currentUser: WorkspaceUser | null;
  /** All agencies the current user belongs to. */
  agencies: WorkspaceAgency[];
  /** Currently selected agency, or null while loading. */
  selectedAgency: WorkspaceAgency | null;
  /** Switch the active workspace. */
  setSelectedAgency: (agencyId: Id<"agencies">) => void;
  /** True while the initial query is still loading. */
  isLoading: boolean;
};

const WorkspaceContext = React.createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  // 1. Resolve the dev user.
  const devUser = useQuery(api.users.useCases.getByPublicId, {
    publicId: DEV_USER_PUBLIC_ID,
  });

  // 2. Load all agencies for that user once we have their id.
  const agenciesRaw = useQuery(
    api.agencies.useCases.listAgenciesForUser,
    devUser ? { userId: devUser._id } : "skip",
  );

  const agencies = (agenciesRaw ?? []).filter(Boolean) as WorkspaceAgency[];

  // 3. Persist selected agency in localStorage.
  const [storedId, setStoredId] = React.useState<Id<"agencies"> | null>(() => {
    if (typeof window === "undefined") return null;
    return (localStorage.getItem(STORAGE_KEY) as Id<"agencies"> | null) ?? null;
  });

  // 4. Derive the effective selected agency id — fall back to the first agency
  //    if the stored value is absent or no longer valid (e.g. after a re-seed).
  const selectedAgencyId = React.useMemo<Id<"agencies"> | null>(() => {
    if (agencies.length === 0) return null;
    if (storedId && agencies.some((a) => a._id === storedId)) return storedId;
    return agencies[0]!._id;
  }, [storedId, agencies]);

  // 5. Keep localStorage in sync whenever the effective selection changes.
  React.useEffect(() => {
    if (selectedAgencyId) {
      localStorage.setItem(STORAGE_KEY, selectedAgencyId);
    }
  }, [selectedAgencyId]);

  const setSelectedAgency = React.useCallback((id: Id<"agencies">) => {
    localStorage.setItem(STORAGE_KEY, id);
    setStoredId(id);
  }, []);

  const selectedAgency = agencies.find((a) => a._id === selectedAgencyId) ?? null;
  const isLoading = devUser === undefined || agenciesRaw === undefined;
  const currentUser: WorkspaceUser | null = devUser
    ? { name: devUser.name, email: devUser.email }
    : null;

  return (
    <WorkspaceContext.Provider
      value={{ currentUser, agencies, selectedAgency, setSelectedAgency, isLoading }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace(): WorkspaceContextValue {
  const ctx = React.useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace must be used inside <WorkspaceProvider>");
  return ctx;
}
