import { fetchQuery } from "convex/nextjs";
import { api } from "@convex/_generated/api";
import { getAuthToken } from "@/lib/auth-token";

export type UserDestination =
  | { kind: "login" }
  | { kind: "onboarding-welcome" }
  | { kind: "onboarding-status"; state: "submitted" | "under_review" }
  | { kind: "onboarding-rejected" }
  | { kind: "dashboard" };

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

  const agencies = await fetchQuery(api.agencies.useCases.listAgenciesForUser, {}, { token });

  if (agencies.length === 0) return { kind: "onboarding-welcome" };

  if (agencies.some((a) => a?.onboardingState === "active")) {
    return { kind: "dashboard" };
  }

  const review = agencies.find((a) => a?.onboardingState === "under_review");
  if (review) return { kind: "onboarding-status", state: "under_review" };

  const submitted = agencies.find((a) => a?.onboardingState === "submitted");
  if (submitted) return { kind: "onboarding-status", state: "submitted" };

  const rejected = agencies.find((a) => a?.onboardingState === "rejected");
  if (rejected) return { kind: "onboarding-rejected" };

  // Fallback: agency exists but is in_progress or not_started — let the
  // user resume the wizard via the welcome page.
  return { kind: "onboarding-welcome" };
}
