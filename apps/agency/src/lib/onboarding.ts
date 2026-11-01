import { fetchQuery } from "convex/nextjs";
import type { FunctionReturnType } from "convex/server";
import { api } from "@convex/_generated/api";
import { getAuthToken } from "@/lib/auth-token";

export type OnboardingStatus = FunctionReturnType<
  typeof api.agencies.useCases.getMyOnboardingStatus
>;
export type OnboardingDraft = FunctionReturnType<typeof api.agencies.useCases.getMyOnboardingDraft>;

/** The signed-in user's onboarding status (incl. rejection reason), or null when signed out. */
export async function fetchMyOnboardingStatus(): Promise<OnboardingStatus | null> {
  const token = await getAuthToken();
  if (!token) return null;
  try {
    return await fetchQuery(api.agencies.useCases.getMyOnboardingStatus, {}, { token });
  } catch {
    return null;
  }
}

/** The signed-in user's in-progress agency as wizard prefill, or null. */
export async function fetchMyOnboardingDraft(): Promise<OnboardingDraft> {
  const token = await getAuthToken();
  if (!token) return null;
  try {
    return await fetchQuery(api.agencies.useCases.getMyOnboardingDraft, {}, { token });
  } catch {
    return null;
  }
}
