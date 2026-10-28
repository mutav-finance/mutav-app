import { fetchMutation, fetchQuery } from "convex/nextjs";
import { api } from "@convex/_generated/api";
import { classifyConvexError, type ConvexErrorKind } from "@mutav/app-shell/convex-error-kind";
import { type FreshIdToken, getFreshIdToken } from "@mutav/app-shell/fresh-id-token";
import { auth0 } from "@/lib/auth0";
import { getIdTokenRefreshWindowSeconds } from "@/lib/env";
import type { Result } from "@/lib/result";

/**
 * Only `session-expired` sends the user to Auth0. A backend failure or a
 * missing `users` row does not: re-running login would complete silently via
 * SSO, the same read would fail again, and the user would loop through Auth0
 * with nothing logged. Those two land on the `/session-error` terminal page.
 */
export type UserDestination =
  | { kind: "session-expired" }
  | { kind: "not-provisioned"; reason?: ProvisionRefusalReason }
  | { kind: "backend-unavailable" }
  | { kind: "staff" }
  | { kind: "onboarding-welcome" }
  | { kind: "onboarding-status"; state: "submitted" | "under_review" }
  | { kind: "onboarding-rejected" }
  | { kind: "dashboard" };

/**
 * Why provisioning refused the identity, in the `?reason=` vocabulary of
 * `/session-error`. Each one tells the user what to do; an unknown code gets
 * no reason and the generic not-provisioned copy.
 */
export type ProvisionRefusalReason = "email-not-verified" | "email-bound";

const REFUSAL_REASON_BY_CODE: Readonly<Record<string, ProvisionRefusalReason>> = {
  EMAIL_NOT_VERIFIED: "email-not-verified",
  EMAIL_BOUND_TO_OTHER_IDENTITY: "email-bound",
};

/** What `getOrCreateByIdentity` returns; only the refusal code is read. */
export type ProvisionResult = Result<unknown, { code: string }>;

/**
 * Logged fields: the error name and its classified kind for a throw, or the
 * refusal code. Never a message: messages and causes can carry identity data.
 */
export type UserDestinationLogFields = { name: string; kind: ConvexErrorKind } | { code: string };

/** The resolver step a failure is logged under. */
export type UserDestinationStep =
  | "getMe"
  | "provision"
  | "getMeAfterProvision"
  | "fetchAgencies"
  | "fetchStaff";

/**
 * Every Convex read throws on failure; the core classifies the throw. Injected
 * so the classification is unit-testable without Auth0 or Convex.
 */
export type UserDestinationDeps = {
  readToken: () => Promise<FreshIdToken>;
  /** `null` when the subject has no `users` row. */
  fetchMe: (token: string) => Promise<unknown>;
  provision: (token: string) => Promise<ProvisionResult>;
  fetchAgencies: (token: string) => Promise<ReadonlyArray<{ onboardingState?: string }>>;
  fetchStaff: (token: string) => Promise<boolean>;
  log: (step: UserDestinationStep, fields: UserDestinationLogFields) => void;
};

type Attempt<T> = { ok: true; value: T } | { ok: false; error: unknown };

async function attempt<T>(run: () => Promise<T>): Promise<Attempt<T>> {
  try {
    return { ok: true, value: await run() };
  } catch (error) {
    return { ok: false, error };
  }
}

function errorFields(error: unknown): UserDestinationLogFields {
  return {
    name: error instanceof Error ? error.name : "unknown",
    kind: classifyConvexError(error),
  };
}

function notProvisioned(code: string): UserDestination {
  const reason = REFUSAL_REASON_BY_CODE[code];
  return reason === undefined ? { kind: "not-provisioned" } : { kind: "not-provisioned", reason };
}

/**
 * `fetch` rejects with a `TypeError` when the request never completed (DNS,
 * connection reset, offline). Convex surfaces every server-side failure as a
 * plain `Error`, so a `TypeError` is the one case that is clearly transport.
 */
function isTransportError(error: unknown): boolean {
  return error instanceof TypeError;
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
 * The destination state machine with its I/O injected. Order matters:
 *
 * 1. No usable token → `session-expired` (the only path back to Auth0).
 * 2. `getMe` throws → `backend-unavailable`. `getMe` returns `null` → one
 *    provisioning attempt, then `getMe` again; still `null`, or a non-transport
 *    provisioning error → `not-provisioned`. A provisioning refusal (Result
 *    `success: false`) → `not-provisioned` with the reason the user can act on. `listAgenciesForUser` and
 *    `amIStaff` are `queryWithAuth` and throw without a row, so this step is
 *    what keeps a missing row from looking like an outage.
 *    Every throw is logged with its `classifyConvexError` kind, but routing
 *    stays on the error page: sending `auth_rejected` to login would loop on a
 *    misconfigured deployment.
 * 3. Agencies, then staff. Staff fails closed: a failed staff read never
 *    yields `dashboard`, so a possibly-staff user is never dropped into the
 *    agency dashboard on a Convex blip.
 */
export async function resolveUserDestinationWith(
  deps: UserDestinationDeps,
): Promise<UserDestination> {
  const freshToken = await deps.readToken();
  if (freshToken.kind !== "token") return { kind: "session-expired" };
  const { token } = freshToken;

  const me = await attempt(() => deps.fetchMe(token));
  if (!me.ok) {
    deps.log("getMe", errorFields(me.error));
    return { kind: "backend-unavailable" };
  }

  if (me.value === null) {
    const provisioned = await attempt(() => deps.provision(token));
    if (!provisioned.ok) {
      deps.log("provision", errorFields(provisioned.error));
      return isTransportError(provisioned.error)
        ? { kind: "backend-unavailable" }
        : { kind: "not-provisioned" };
    }
    if (!provisioned.value.success) {
      const { code } = provisioned.value.error;
      deps.log("provision", { code });
      return notProvisioned(code);
    }
    const meAgain = await attempt(() => deps.fetchMe(token));
    if (!meAgain.ok) {
      deps.log("getMeAfterProvision", errorFields(meAgain.error));
      return { kind: "backend-unavailable" };
    }
    if (meAgain.value === null) return { kind: "not-provisioned" };
  }

  const agenciesResult = await attempt(() => deps.fetchAgencies(token));
  if (!agenciesResult.ok) {
    deps.log("fetchAgencies", errorFields(agenciesResult.error));
    return { kind: "backend-unavailable" };
  }
  const agencies = agenciesResult.value;

  // Staff branch runs before the onboarding/dashboard branches: a Mutav-org
  // user with no active agency routes to the admin app.
  const staff = await attempt(() => deps.fetchStaff(token));
  if (!staff.ok) {
    deps.log("fetchStaff", errorFields(staff.error));
    return { kind: "backend-unavailable" };
  }
  if (shouldRouteStaffToAdmin({ isStaff: staff.value, agencies })) return { kind: "staff" };

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

/**
 * Single source of truth for "where should this user be?". Reads the
 * Auth0 session, the user row and agency memberships and returns a
 * discriminated destination — callers (layouts, page-level reverse guards)
 * translate it into the right redirect target.
 *
 * The point of routing every entry through this is that `/` and
 * `/onboarding` (and any future entry) all agree on the same state
 * machine instead of drifting apart.
 */
export function resolveUserDestination(): Promise<UserDestination> {
  return resolveUserDestinationWith({
    // "never": a Server Component cannot persist a refreshed session cookie,
    // so the proxy refreshes ahead of expiry and this only reads what is there.
    readToken: () =>
      getFreshIdToken({
        auth0,
        refreshWindowSeconds: getIdTokenRefreshWindowSeconds(),
        refresh: "never",
      }),
    fetchMe: (token) => fetchQuery(api.users.useCases.getMe, {}, { token }),
    provision: (token) => fetchMutation(api.users.useCases.getOrCreateByIdentity, {}, { token }),
    fetchAgencies: (token) => fetchQuery(api.agencies.useCases.listAgenciesForUser, {}, { token }),
    fetchStaff: (token) => fetchQuery(api.mutavStaff.useCases.amIStaff, {}, { token }),
    log: (step, fields) => console.error(`[agency] user-destination ${step} failed`, fields),
  });
}
