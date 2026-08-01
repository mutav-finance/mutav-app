import { buildCrossAppUrl } from "@mutav/i18n/cross-app";
import { routing } from "@mutav/i18n/routing";
import type { StaffGateResult } from "@/lib/auth";

type TitleKey = "title" | "anonymousTitle" | "staffTitle";
type SubtitleKey = "subtitle" | "anonymousSubtitle" | "staffSubtitle";
type PrimaryLabelKey = "goToAgency" | "goToAdmin";
type SecondaryLabelKey = "signIn" | "signOut";

export type AccessDeniedView = {
  titleKey: TitleKey;
  subtitleKey: SubtitleKey;
  primary: { href: string; labelKey: PrimaryLabelKey };
  secondary: { href: string; labelKey: SecondaryLabelKey };
  /** Empty when there is no session, or when the session carries no email. */
  email: string;
};

/**
 * Maps a staff-gate result to what the access-denied page renders.
 *
 * Pure on purpose: the page is a server component with no DOM test harness in
 * this repo, so the branching lives here where it can be covered directly.
 */
export function resolveAccessDeniedView({
  gate,
  locale,
  agencyUrl,
}: {
  gate: StaffGateResult;
  locale: string;
  agencyUrl: string;
}): AccessDeniedView {
  // `/auth/*` is mounted by the Auth0 SDK outside the `[locale]` tree, so
  // these two are never locale-prefixed.
  const signIn = { href: "/auth/login", labelKey: "signIn" } as const;
  const signOut = { href: "/auth/logout", labelKey: "signOut" } as const;

  if (gate.kind === "anonymous") {
    // Not a denial: a signed-out visitor may well be staff. Claiming they lack
    // access would be wrong, and would push a real staff member away.
    return {
      titleKey: "anonymousTitle",
      subtitleKey: "anonymousSubtitle",
      primary: { href: buildCrossAppUrl(agencyUrl, locale), labelKey: "goToAgency" },
      secondary: signIn,
      email: "",
    };
  }

  const email = gate.session.user.email?.trim() ?? "";

  if (gate.kind === "staff") {
    // Mirrors `buildCrossAppUrl`'s rule for a same-origin root: `as-needed`
    // prefixing leaves the default locale unprefixed.
    const adminRootHref = locale === routing.defaultLocale ? "/" : `/${locale}`;
    return {
      titleKey: "staffTitle",
      subtitleKey: "staffSubtitle",
      primary: { href: adminRootHref, labelKey: "goToAdmin" },
      secondary: signOut,
      email,
    };
  }

  return {
    titleKey: "title",
    subtitleKey: "subtitle",
    primary: { href: buildCrossAppUrl(agencyUrl, locale), labelKey: "goToAgency" },
    secondary: signOut,
    email,
  };
}
