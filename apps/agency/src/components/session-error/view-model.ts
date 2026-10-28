/**
 * The two server-side failures that are NOT a reason to send the user back to
 * Auth0 (see `resolveUserDestination`). They arrive as `?reason=`.
 */
export type SessionErrorReason = "not-provisioned" | "backend-unavailable";

/** Drives the marker icon. The page owns the icon components; this stays pure. */
export type SessionErrorTone = "notProvisioned" | "backendUnavailable";

type CopyKey<TPrefix extends SessionErrorTone> =
  | `${TPrefix}.eyebrow`
  | `${TPrefix}.title`
  | `${TPrefix}.subtitle`;

export type SessionErrorView = {
  tone: SessionErrorTone;
  eyebrowKey: CopyKey<SessionErrorTone>;
  titleKey: CopyKey<SessionErrorTone>;
  subtitleKey: CopyKey<SessionErrorTone>;
};

/**
 * `?reason=` is user-controlled. Anything other than the two known values —
 * missing, repeated, or made up — reads as the generic outage, which promises
 * nothing about the account.
 */
export function parseSessionErrorReason(raw: string | string[] | undefined): SessionErrorReason {
  return raw === "not-provisioned" ? "not-provisioned" : "backend-unavailable";
}

/**
 * Maps a reason to what the session-error page renders. Pure on purpose: the
 * page is a server component with no DOM test harness in this repo.
 */
export function resolveSessionErrorView(reason: SessionErrorReason): SessionErrorView {
  if (reason === "not-provisioned") {
    return {
      tone: "notProvisioned",
      eyebrowKey: "notProvisioned.eyebrow",
      titleKey: "notProvisioned.title",
      subtitleKey: "notProvisioned.subtitle",
    };
  }
  return {
    tone: "backendUnavailable",
    eyebrowKey: "backendUnavailable.eyebrow",
    titleKey: "backendUnavailable.title",
    subtitleKey: "backendUnavailable.subtitle",
  };
}
