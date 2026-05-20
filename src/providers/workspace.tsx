"use client";

/**
 * WorkspaceContext — resolves the current user + selected agency.
 *
 * Identity comes from `api.users.useCases.getMe`, which handles both
 * paths: JWT-subject lookup when Auth0 is wired, dev-user fallback when
 * it isn't. The client doesn't pass any user identifier — the server
 * resolves it from the bearer token (or absence thereof).
 */

import * as React from "react";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "@convex/_generated/api";
import type { AgencyId } from "@convex/agencies/domain";

const STORAGE_KEY = "sgr:selectedAgencyId";

/**
 * Derived from the Convex return type so additions to the server-side projection
 * flow through here automatically (no manual sync, no escape-hatch casts).
 */
export type WorkspaceAgency = NonNullable<
  FunctionReturnType<typeof api.agencies.useCases.listAgenciesForUser>[number]
>;

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
  setSelectedAgency: (agencyId: AgencyId) => void;
  /** True while the initial query is still loading. */
  isLoading: boolean;
};

const WorkspaceContext = React.createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({ children }: { children: React.ReactNode }) {
  // Resolve the current user (for header display). Identity comes from
  // the JWT (Auth0) or the dev-user fallback (no Auth0). The agencies
  // query likewise reads identity server-side via `queryWithAuth` — no
  // userId arg, no impersonation surface.
  const currentUserRow = useQuery(api.users.useCases.getMe, {});
  const agenciesRaw = useQuery(api.agencies.useCases.listAgenciesForUser, {});
  const provisionMe = useMutation(api.users.useCases.getOrCreateByIdentity);

  // Client-side provisioning fallback: if Auth0 is wired (so `getMe` is
  // querying by JWT subject) but no row exists yet, kick off a one-shot
  // provisioning mutation. Covers the gap when `onCallback` in
  // `src/lib/auth0.ts` failed transiently — the next session start retries.
  React.useEffect(() => {
    if (currentUserRow === null && typeof window !== "undefined") {
      void provisionMe({}).catch(() => {});
    }
  }, [currentUserRow, provisionMe]);

  const agencies = (agenciesRaw ?? []).filter((a): a is WorkspaceAgency => a !== null);

  const [storedRaw, setStoredRaw] = React.useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return localStorage.getItem(STORAGE_KEY);
  });

  // Stored id can be stale (e.g. after a re-seed) — fall back to the first
  // agency if it no longer matches any known id.
  const selectedAgencyId = React.useMemo<AgencyId | null>(() => {
    const first = agencies[0];
    if (!first) return null;
    if (storedRaw) {
      const match = agencies.find((a) => a._id === storedRaw);
      if (match) return match._id;
    }
    return first._id;
  }, [storedRaw, agencies]);

  // 5. Keep localStorage in sync whenever the effective selection changes.
  React.useEffect(() => {
    if (selectedAgencyId) {
      localStorage.setItem(STORAGE_KEY, selectedAgencyId);
    }
  }, [selectedAgencyId]);

  const setSelectedAgency = React.useCallback((id: AgencyId) => {
    localStorage.setItem(STORAGE_KEY, id);
    setStoredRaw(id);
  }, []);

  const selectedAgency = agencies.find((a) => a._id === selectedAgencyId) ?? null;
  const isLoading = currentUserRow === undefined || agenciesRaw === undefined;
  const currentUser: WorkspaceUser | null = currentUserRow
    ? { name: currentUserRow.name, email: currentUserRow.email }
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
