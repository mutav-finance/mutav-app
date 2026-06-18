import { fetchQuery } from "convex/nextjs";
import { api } from "@convex/_generated/api";
import { getAuthToken } from "@/lib/auth-token";

export type UserDestination =
  | { kind: "login" }
  | { kind: "staff" }
  | { kind: "onboarding-welcome" }
  | { kind: "onboarding-status"; state: "submitted" | "under_review" }
  | { kind: "onboarding-rejected" }
  | { kind: "dashboard" };

async function fetchAgencies(token: string) {
  try {
    return await fetchQuery(api.agencies.useCases.listAgenciesForUser, {}, { token });
  } catch {
    return null;
  }
}

async function fetchStaff(token: string): Promise<boolean | null> {
  try {
    return await fetchQuery(api.mutavStaff.useCases.amIStaff, {}, { token });
  } catch {
    return null;
  }
}

/**
 * Pure routing decision: a Mutav-org user (staff) with no active agency
 * belongs on the admin app, not the agency dashboard. Staff WITH an active
 * agency fall through to the dashboard and cross via the shell-switcher
 * (Phase E). Active-agency predicate mirrors the dashboard branch below.
 */
export function shouldRouteStaffToAdmin({
  isStaff,
  agencies,
}: {
  isStaff: boolean;
  // ReadonlyArray makes the element type covariant, so callers can pass a
  // list whose `onboardingState` is a narrower union literal than `string`.
  // Optional because the resolved agency doc has it as `v.optional(...)`.
  agencies: ReadonlyArray<{ onboardingState?: string }>;
}): boolean {
  return isStaff && !agencies.some((a) => a.onboardingState === "active");
}

/**
 * Single source of truth for "where should this user be?". Reads the
 * Auth0 session + agency memberships and returns a discriminated
 * destination — callers (layouts, page-level reverse guards) translate
 * it into the right redirect target.
 *
 * The point of routing every entry through this is that `/` and
 * `/onboarding` (and any future entry) all agree on the same state
 * machine instead of drifting apart.
 */
export async function resolveUserDestination(): Promise<UserDestination> {
  const token = await getAuthToken();
  if (!token) return { kind: "login" };

  const agencies = await fetchAgencies(token);
  if (!agencies) return { kind: "login" };

  // Staff branch runs before the onboarding/dashboard branches: a
  // Mutav-org user with no active agency routes to the admin app. Fail
  // closed on a failed staff fetch — never drop a possibly-staff user
  // into the agency dashboard on a Convex blip / token race.
  const staff = await fetchStaff(token);
  if (staff === null) return { kind: "login" };
  if (shouldRouteStaffToAdmin({ isStaff: staff, agencies })) return { kind: "staff" };

  if (agencies.length === 0) return { kind: "onboarding-welcome" };

  if (agencies.some((a) => a.onboardingState === "active")) {
    return { kind: "dashboard" };
  }

  const review = agencies.find((a) => a.onboardingState === "under_review");
  if (review) return { kind: "onboarding-status", state: "under_review" };

  const submitted = agencies.find((a) => a.onboardingState === "submitted");
  if (submitted) return { kind: "onboarding-status", state: "submitted" };

  const rejected = agencies.find((a) => a.onboardingState === "rejected");
  if (rejected) return { kind: "onboarding-rejected" };

  // Fallback: agency exists but is in_progress or not_started — let the
  // user resume the wizard via the welcome page.
  return { kind: "onboarding-welcome" };
}
