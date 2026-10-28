# Auth0 change verification: commands and snippets

Read this when you run the verification in `SKILL.md`. Run only the test files you touched, with a worker cap, and never use watch mode.

## 1. Unit tests for the header composition

The file is `packages/app-shell/src/proxy-headers.test.ts` (Vitest). Build the Auth0 side the way the SDK does on a rolling refresh: cookies plus the no-store headers.

```ts
import { NextResponse } from "next/server";
import { describe, expect, test } from "vitest";
import { carryAuthHeaders } from "./proxy-headers";

const NO_STORE = "private, no-cache, no-store, must-revalidate, max-age=0";

function authResponse(): NextResponse {
  const res = NextResponse.next(); // carries x-middleware-next, like the SDK's
  res.cookies.set("__session", "session-value", {
    httpOnly: true, secure: true, sameSite: "lax", path: "/",
    expires: new Date(Date.UTC(2030, 0, 1)), // fixed date: maxAge would serialize a clock-dependent Expires
  });
  res.cookies.set("__session__1", "", { path: "/", maxAge: 0 }); // chunk deletion
  res.headers.set("cache-control", NO_STORE);
  res.headers.set("pragma", "no-cache");
  return res;
}

test("carries no-store", () => {
  const merged = carryAuthHeaders({ from: authResponse(), to: NextResponse.next() });
  expect(merged.headers.get("cache-control")).toBe(NO_STORE);
});

test("never carries x-middleware-next onto a redirect", () => {
  const redirect = NextResponse.redirect("https://app.example/en");
  const merged = carryAuthHeaders({ from: authResponse(), to: redirect });
  expect(merged.headers.get("x-middleware-next")).toBeNull();
});
```

If `onCallback` or the redirect builder changes, extend `packages/app-shell/src/auth-redirect.test.ts` with hostile `returnTo` values. The SDK's login check only proves same-origin, then stores the path, so these are the shapes that reach the hook:

```ts
test.each(["//evil.example/x", "/\\evil.example", "https://evil.example/"])(
  "post-login redirect stays on origin for %s",
  (returnTo) => {
    const url = sameOriginRedirectUrl({ returnTo, baseUrl: "https://app.mutav.finance" });
    expect(url.origin).toBe("https://app.mutav.finance");
  },
);
```

Keep the existing cases as well: the session cookie keeps every attribute (assert the exact serialized string), a chunk deletion stays `Max-Age=0`, the target's own `NEXT_LOCALE` cookie survives and comes first, and an empty source adds nothing.

```bash
# from packages/app-shell — the root test:file script only covers convex/ and tests/
bun run test src/proxy-headers.test.ts src/auth-redirect.test.ts --maxWorkers=2
```

## 2. Browser check (local or preview)

Ports: agency `3000`, admin `3003`. `pt-BR` has no URL prefix. Log in as a persona from `docs/test-personas.md`, then make at least two in-app navigations before you check anything, so the rolling refresh path has run (a fresh callback alone does not exercise the proxy fold).

Page JS must not see the session:

```js
// run in the page (Playwright evaluate / devtools console)
document.cookie.split("; ").map((c) => c.split("=")[0]);
// expected: no "__session" and no "__session__N"; NEXT_LOCALE etc. may appear
```

The cookie jar flags, with names and flags only and never `value`:

```js
const jar = await page.context().cookies();
jar
  .filter((c) => c.name.startsWith("__session") || c.name.startsWith("__txn"))
  .map(({ name, httpOnly, secure, sameSite, expires, domain }) => ({ name, httpOnly, secure, sameSite, expires, domain }));
// expected for __session: httpOnly true, sameSite "Lax", expires > 0,
// secure true on https (false only on http://localhost for agency),
// domain = the exact host (no leading dot → host-only)
```

The `Cache-Control` header on a page response after the refresh:

```bash
# Headers only; the cookie is sent from a file you never print.
curl -s -o /dev/null -D - -b "$TMPDIR/jar.txt" https://admin.mutav.finance/ | grep -i -E '^(cache-control|set-cookie):' | sed -E 's/=([^;]*)/=<redacted>/'
# expected: cache-control: private, no-cache, no-store, must-revalidate, max-age=0
```

With Playwright, `page.on("response", r => r.headers()["cache-control"])` on a document navigation does the same job without handling the cookie at all. Prefer that.

Then the flow:

- Log out through the UI link: you reach a logged-out state and `__session` is gone from the jar.
- Log back in: Auth0, then `/auth/callback`, then the original locale and page. There must be no second Auth0 round trip, no `InvalidStateError`, and no stray `__txn_*` cookies piling up.
- For admin, also sign in as a non-staff persona: you should land on `/access-denied` (fail closed), not get a session loop.

## 3. After deploy

Repeat section 2 against `https://app.mutav.finance` and `https://admin.mutav.finance`. Here `secure` must be true everywhere. Report each check as pass or fail with names and flags. If the run stopped at the Auth0 redirect, say so plainly.
