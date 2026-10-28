import { redirect as nextRedirect } from "next/navigation";
import { getPathname, redirect } from "@mutav/i18n/navigation";
import type { UserDestination } from "@/lib/user-destination";

/**
 * Shared by every caller of `resolveUserDestination`, so they all leave on
 * the same terms when the destination is a failure:
 *
 * - `session-expired` → Auth0 Universal Login, with `returnTo` set to the
 *   caller's own path in the shape next-intl builds it (`as-needed`: no
 *   prefix for pt-BR). The SDK routes sit at the root, outside `[locale]`,
 *   so this is `next/navigation`'s redirect.
 * - `not-provisioned` / `backend-unavailable` → `/session-error`, with a
 *   provisioning refusal's own reason (`email-not-verified`, `email-bound`)
 *   when there is one, so the page can say what to do. It sits
 *   outside every gated group, never resolves a destination, and never
 *   redirects. Sending these to login would loop through Auth0 via SSO.
 *
 * Any other destination returns, and the caller routes it.
 */
export function redirectOnSessionFailure({
  destination,
  locale,
  returnHref,
}: {
  destination: UserDestination;
  locale: string;
  /** The caller's own locale-less path, e.g. `/` or `/onboarding`. */
  returnHref: string;
}): void {
  if (destination.kind === "session-expired") {
    const returnTo = getPathname({ href: returnHref, locale });
    nextRedirect(`/auth/login?returnTo=${encodeURIComponent(returnTo)}`);
  }
  if (destination.kind === "not-provisioned") {
    redirect({ href: `/session-error?reason=${destination.reason ?? destination.kind}`, locale });
  }
  if (destination.kind === "backend-unavailable") {
    redirect({ href: `/session-error?reason=${destination.kind}`, locale });
  }
}
