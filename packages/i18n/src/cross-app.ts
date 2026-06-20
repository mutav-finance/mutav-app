import { routing } from "./routing";

/**
 * Builds a cross-app (cross-origin) absolute URL from a TRUSTED env base
 * and a locale segment. Open-redirect safety: the only thing interpolated
 * is a locale validated against `routing.locales` — never a request-supplied
 * path or host.
 *
 * next-intl's `localePrefix` is `as-needed`, so the default locale (pt-BR)
 * is unprefixed and only non-default known locales (en) carry a `/<locale>`
 * segment. Unknown / unvalidated locales fall through to the bare base.
 */
export function buildCrossAppUrl(base: string, locale: string): string {
  const knownLocales: readonly string[] = routing.locales;
  const isKnownNonDefault = knownLocales.includes(locale) && locale !== routing.defaultLocale;
  return isKnownNonDefault ? `${base}/${locale}` : base;
}
