# Technical Research — Next.js 16 + Convex + React 19

> Phase: research | Project: payment-flow | Date: 2026-05-13

## 1. Public route group in Next.js 16 App Router

The `(public)` route group sits sibling to `(app)`. Both consume the `[locale]` segment. Layout responsibilities:

```
src/app/[locale]/
├── (app)/layout.tsx          # auth-required, sidebar shell
└── (public)/
    ├── layout.tsx            # forces theme="light", no nav chrome
    └── pagar/[publicId]/
        ├── page.tsx          # method picker (RSC)
        ├── error.tsx         # "use client" error boundary
        ├── not-found.tsx     # invalid publicId
        ├── pix/page.tsx
        ├── boleto/page.tsx
        ├── stellar/page.tsx
        └── recibo/page.tsx
```

Route groups (parentheses-prefixed) are URL-invisible — `/pagar/X` is the public URL, not `/(public)/pagar/X`. This is the documented escape hatch for sibling layouts under the same locale.

**Theme forcing:** the `(public)/layout.tsx` wraps children in a `<ThemeProvider forcedTheme="light">` (next-themes API) so dark-mode preference is overridden. Per brief: tenants don't expect dark mode; light is the trust baseline.

**No auth check:** unlike `(app)/layout.tsx` which redirects unauthenticated users, `(public)/layout.tsx` performs zero identity work. The public query (see §4) handles all access control via `publicId` lookup.

Source: [Next.js docs — Route Groups](https://nextjs.org/docs/app/api-reference/file-conventions/route-groups)

## 2. preloadQuery in a public RSC

The `convex/nextjs` package exports `preloadQuery` for server-rendering Convex data. Critical constraints for a no-auth public route:

```ts
// src/app/[locale]/(public)/pagar/[publicId]/page.tsx
import { preloadQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import { notFound } from "next/navigation";

export default async function PagarPage({ params }: { params: Promise<{ publicId: string }> }) {
  const { publicId } = await params;
  const preloadedPayment = await preloadQuery(api.payments.getPublicByPublicId, { publicId });
  const payment = preloadedPayment._valueJSON;
  if (!payment) notFound();
  return <MethodPicker preloaded={preloadedPayment} />;
}
```

Key facts:
- `preloadQuery` uses `cache: 'no-store'` internally → the page is **dynamic** by definition. Cannot be statically rendered. This is fine — payment state must always be fresh.
- Required env: `NEXT_PUBLIC_CONVEX_URL` must be set at build AND request time.
- The returned `Preloaded<T>` opaque structure is passed to a client island that calls `usePreloadedQuery` — gives SSR data + live subscription after hydration.
- For Next.js 16: `params` is a Promise (async params). Must be `await`ed.

**Important pitfall:** `preloadQuery` does **not** carry an auth token by default. In our public route this is desired. In `(app)` routes we'd pass `{ token }`; here we omit it intentionally.

Source: [Convex Next.js Server Rendering docs](https://docs.convex.dev/client/nextjs/app-router/server-rendering)

## 3. Convex public query — no `ctx.auth` requirement

`convex/payments/useCases.ts`:

```ts
import { query } from "../_generated/server";
import { v } from "convex/values";
import type { Result } from "../lib/result";

export const getPublicByPublicId = query({
  args: { publicId: v.string() },
  handler: async (ctx, { publicId }): Promise<PublicPaymentResult> => {
    const payment = await ctx.db
      .query("payments")
      .withIndex("by_publicId", q => q.eq("publicId", publicId))
      .unique();
    if (!payment) return { success: false, error: { code: "NOT_FOUND" }, message: "..." };
    // shape projection — strip imobiliária-internal fields
    return { success: true, data: shapePublicPayment(payment, agency), message: "ok" };
  },
});
```

Three rules:
1. **No `ctx.auth.getUserIdentity()` call.** Convex queries are public by default; auth is opt-in. This is the entire access mechanism — a guess-resistant `publicId` (UUIDv4 or nanoid recommended) IS the bearer token.
2. **Schema needs `by_publicId` index** on the `payments` table. Without it, `.filter()` falls back to a full table scan (Convex per-query budget hit).
3. **Shape projection is mandatory.** The raw `Doc<'payments'>` carries agencyId, internal notes, audit fields the tenant must not see. `shapePublicPayment` returns only: amount, dueDate, agencyContact, state, method. Never spread.

This is the documented Convex pattern for public queries — see `convex-document-types` and `convex-functional-programming` skills in this repo.

## 4. Magic-link token tradeoff — publicId v1 → signed JWT v2

| Aspect | v1: bare `publicId` | v2: signed token (HMAC or JWT) |
|---|---|---|
| URL example | `/pagar/01H8XY...` | `/pagar/01H8XY...?t=eyJ...` |
| Server check | DB lookup by publicId | Verify signature, decode → lookup |
| Revocation | DB flag `canceledAt` | Token expiry or JTI deny-list |
| Forwarded-link risk | Anyone with URL can view | Token expires |
| Effort to ship v1 | 30 min | 1-2 days |

**Decision for v1:** ship with bare `publicId`. Rationale:
- Tenants commonly forward "the link" via WhatsApp — friction is unacceptable
- `publicId` must already be a high-entropy string (≥122 bits) — UUIDv4 or nanoid(21)
- The threat model is "guess the URL" not "intercept a friend's WhatsApp" — entropy defeats guessing
- v2 introduces signed tokens with 30-day expiry as the security hardening pass

**v2 hook points:** add a `payments.signedToken` field (HMAC over publicId + agencyId + expiry); the query becomes `getPublicByPublicIdAndToken({ publicId, token })`. The route adds the query param. No schema-breaking change.

## 5. QR code rendering — server SVG vs client canvas

Three viable approaches with React 19 + Next.js 16:

| Approach | Library | Pros | Cons |
|---|---|---|---|
| Server SVG in RSC | `qrcode` (node-qrcode) | No client JS, SEO-friendly, inert, smallest payload | Cannot react to client interactions; renders once at request time |
| Client SVG | `qrcode.react` | Reactive, easy props | Adds ~5kB to client bundle; uses DOM APIs |
| Client canvas | `qrcode.react` canvas mode | Smaller DOM, sharp at any DPR | Not selectable, harder to a11y-label |

**Recommendation:** server SVG via `qrcode` package, called from the PIX route's RSC. The QR string is determined at request time (depends on `payment.method.pixKey` from DB) — no need for client reactivity. Smaller payload, cleaner a11y story (the SVG can carry `<title>` and `<desc>` for screen readers).

```ts
// src/app/[locale]/(public)/pagar/[publicId]/pix/page.tsx
import QRCode from "qrcode";
const svg = await QRCode.toString(pixPayload, { type: "svg", margin: 1, width: 240 });
// pass svg string to a client component that does dangerouslySetInnerHTML in a controlled wrapper
```

Important: the QR string is the **BCB EMV BR Code** (full payload from §reference-specs), not the bare PIX key. Including amount + txid in the QR is what makes it a dynamic charge.

Sources: [qrcode (node-qrcode)](https://www.npmjs.com/package/qrcode) · [qrcode.react](https://www.npmjs.com/package/qrcode.react)

## 6. Boleto barcode rendering — bwip-js in RSC

`bwip-js` is Node-compatible and supports SVG output for `interleaved2of5` (the FEBRABAN barcode symbology):

```ts
// in the boleto RSC
import bwipjs from "@bwip-js/node";
const svgString = await bwipjs.toSVG({
  bcid: "interleaved2of5",
  text: barcodeDigits, // 44-digit barcode (NOT linha digitável)
  height: 18,            // ~38mm at standard scale
  includetext: false,    // we render linha digitável separately with monospace
  textxalign: "center",
});
```

Critical details:
- Input is the 44-digit **barcode** representation, not the 47-char linha digitável (which is a human-friendly transformation)
- Symbology is `interleaved2of5` per FEBRABAN convention
- We render the linha digitável as a separate `Mono` text block below the SVG — sharper than embedding text in the barcode SVG
- `@bwip-js/node` is the Node entry point; works fine in Next.js RSC (no browser globals)

For v1, the `barcode` field in `payments.method` is fixture data; we just feed it to bwip-js. PSP integration (Issue #19) populates real values.

Source: [bwip-js GitHub](https://github.com/metafloor/bwip-js) · [@bwip-js/node](https://www.npmjs.com/package/@bwip-js/node)

## 7. Clipboard API — CopyableValue primitive

`navigator.clipboard.writeText` works in modern browsers but Safari (macOS + iOS) requires **transient activation**: the call must happen synchronously inside a user-initiated event handler. Async work between click and writeText breaks iOS.

```tsx
// CopyableValue.tsx
"use client";
const onCopy = (value: string) => {
  // SYNCHRONOUS — do not await anything before writeText
  navigator.clipboard.writeText(value).then(
    () => toast.success(t("copied")),
    () => toast.error(t("copyFailed")),
  );
};
```

Anti-patterns to avoid:
- Don't `await fetch(...)` before calling `writeText` — kills iOS transient activation
- Don't fall back to `document.execCommand('copy')` — deprecated, removed in latest Safari
- If `navigator.clipboard` is undefined (very old browser / http context), show the string in a selectable monospace block as the fallback — degrade visibly, never silently

The `CopyableValue` primitive ships value + label as props; the FULL value is passed to clipboard regardless of any truncated display.

Source: [WebKit Async Clipboard API](https://webkit.org/blog/10855/async-clipboard-api/)

## 8. State machine — `payment.state × payment.method`

The discriminated unions in schema are the canonical state. Frontend derives screen via a single match function:

```ts
function selectScreen(p: PublicPayment): Screen {
  if (p.state.kind === "canceled") return "canceled";
  if (p.state.kind === "paid") return "receipt";
  if (p.state.kind === "overdue") return p.method === null ? "expired-no-method" : "expired-with-method";
  // pending
  if (p.method === null) return "method-picker";
  return p.method.kind; // "pix" | "boleto" | "stellar"
}
```

This collapses to 7 distinct screens (see ux-patterns.md §2). The router uses this in two places:
1. Server: `page.tsx` for `/pagar/[publicId]` redirects to the sub-route matching the screen
2. Client: the live subscription via `usePreloadedQuery` re-renders if state flips during the session (e.g. `paid` arrives while the tenant is on `/pix`)

**Reactive transitions:** when state flips `pending → paid` while the user has the QR open, the client island detects the change and `router.replace`s to `/recibo`. The user sees the receipt without a refresh — this is the Convex live-subscription payoff.

## 9. notFound() & error.tsx boundaries

- `notFound()` thrown inside `page.tsx` triggers the nearest `not-found.tsx` (or default 404). Use it for missing/invalid `publicId`.
- `error.tsx` MUST be `"use client"`, receives `{ error, reset }`. Use it for Convex query failures (network), mutation errors that escape the Result pattern. Never expose `error.message` — map `error.digest` or a known code to a localized string.
- `global-error.tsx` at the app root catches layout-level errors. We don't need a special one for the public flow — the default suffices.

Source: [Next.js — error.tsx](https://nextjs.org/docs/app/api-reference/file-conventions/error)

## 10. Result pattern + next-intl error mapping

Mutations (`chooseMethod`, `submitStellarTx`) return `Result<S, E>` with `error.code` from a closed enum:

```ts
const PAYMENT_ERROR_CODE = {
  NOT_FOUND: "NOT_FOUND",
  ALREADY_PAID: "ALREADY_PAID",
  WRONG_STATE: "WRONG_STATE",
  INVALID_TX_HASH: "INVALID_TX_HASH",
} as const satisfies Record<string, string>;
```

Frontend maps to messages:

```tsx
if (!result.success) {
  toast.error(t(`errors.${result.error.code}`));
}
```

`messages/pt-BR.json` and `messages/en.json` each declare the same keys under `payment.errors.*`. Missing keys silently fall back to the key string — CI lint to verify parity.

## Sources

- [Next.js 16 App Router](https://nextjs.org/docs/app)
- [Convex Next.js Server Rendering](https://docs.convex.dev/client/nextjs/app-router/server-rendering)
- [Convex API: nextjs module](https://docs.convex.dev/api/modules/nextjs)
- [qrcode (node-qrcode) npm](https://www.npmjs.com/package/qrcode)
- [bwip-js GitHub](https://github.com/metafloor/bwip-js)
- [WebKit Async Clipboard API](https://webkit.org/blog/10855/async-clipboard-api/)
- [Clipboard transient activation explainer](https://dev.to/tusharshahi/transient-activation-why-our-apps-copy-button-did-not-work-on-iphone-4ba0)
- [React 19.2 useEffectEvent](https://react.dev/reference/react/useEffectEvent)
