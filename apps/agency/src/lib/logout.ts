import { crossAppLogoutHref } from "@mutav/app-shell/cross-app-logout-href";
import { getAdminUrl } from "@/lib/env";

/**
 * Every logout link in this app. It starts on the admin app so both apps drop
 * their session before Auth0 ends it; see `@mutav/app-shell/cross-app-logout`.
 * A plain `<a>`, never next/link: the route is mounted outside `[locale]`.
 */
export function getLogoutHref(): string {
  return crossAppLogoutHref(getAdminUrl());
}
