/**
 * The server-side failures that are NOT a reason to send the user back to
 * Auth0 (see `resolveUserDestination`). They arrive as `?reason=`. The two
 * `email-*` reasons are provisioning refusals the user can act on.
 */
export type SessionErrorReason =
  | "not-provisioned"
  | "backend-unavailable"
  | "email-not-verified"
  | "email-bound";

/** Drives the marker icon. The page owns the icon components; this stays pure. */
export type SessionErrorTone =
  | "notProvisioned"
  | "backendUnavailable"
  | "emailNotVerified"
  | "emailBound";

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

const TONE_BY_REASON = {
  "not-provisioned": "notProvisioned",
  "backend-unavailable": "backendUnavailable",
  "email-not-verified": "emailNotVerified",
  "email-bound": "emailBound",
} as const satisfies Record<SessionErrorReason, SessionErrorTone>;

function isSessionErrorReason(raw: string): raw is SessionErrorReason {
  return Object.hasOwn(TONE_BY_REASON, raw);
}

/**
 * `?reason=` is user-controlled. Anything other than a known value — missing,
 * repeated, or made up — reads as the generic outage, which promises nothing
 * about the account.
 */
export function parseSessionErrorReason(raw: string | string[] | undefined): SessionErrorReason {
  if (typeof raw !== "string" || !isSessionErrorReason(raw)) return "backend-unavailable";
  return raw;
}

/**
 * Maps a reason to what the session-error page renders. Pure on purpose: the
 * page is a server component with no DOM test harness in this repo.
 */
export function resolveSessionErrorView(reason: SessionErrorReason): SessionErrorView {
  const tone = TONE_BY_REASON[reason];
  return {
    tone,
    eyebrowKey: `${tone}.eyebrow`,
    titleKey: `${tone}.title`,
    subtitleKey: `${tone}.subtitle`,
  };
}
