# Screen 06 — Error Boundary

> Chunk: screen-06-error | Phase: design | Project: payment-flow | Generated: 2026-05-13
> Route: `/[locale]/(public)/pagar/[publicId]/error.tsx`

## Purpose

Catches React render errors and unhandled promise rejections inside the `/pagar/[publicId]` route segment (including child segments `/endereco`, `/carteira`, `/recibo`, `/encerrado`). The most likely sources:

- Convex outage during `useQuery(getPublicByPublicId)` after initial SSR has succeeded
- Schema-mismatch on `payment` shape after a Convex deploy
- `i18n` namespace-load failure
- Any thrown `Error` not caught by deeper boundaries

The screen renders the **same visual shape as Screen 05** (PaymentExpiredCard) — same Card, same PaymentStateTag pattern, same CTA shape — with two differences:

1. The primary CTA is **`Tentar novamente`** (calls Next.js `reset()`); the agency-contact link sits below it as a secondary action.
2. PaymentSummaryHeader is omitted (we may not have payment data — the error is what we have).

This is a `"use client"` component per Next.js 16 convention; it receives `{ error: Error & { digest?: string }, reset: () => void }`.

## User flow position

```
[Any /pagar/[publicId]/* segment throws]
                ↓
            error.tsx        ← THIS SCREEN
                │
                ├─ Tap "Tentar novamente" → reset() → re-render the segment
                ├─ Tap "Fale com {agencyName}" → mailto: / tel:
                └─ Refresh → bypass reset(); full RSC re-resolution
```

## Layout

```
┌────────────────────────────────────────┐
│  tga                            pt-BR  │  ← PublicShell header
├────────────────────────────────────────┤
│                                        │
│   ┌──────────────────────────────────┐ │
│   │  ▪ ERRO                          │ │  ← PaymentStateTag (error variant)
│   │                                  │ │     #C94040 square + ERRO label
│   │  Não conseguimos carregar        │ │  ← Geist Bold 24px (<h1>)
│   │  este pagamento                  │ │
│   │                                  │ │
│   │  Tente novamente em alguns       │ │  ← Inter body
│   │  instantes. Se o problema        │ │
│   │  persistir, fale com sua         │ │
│   │  imobiliária.                    │ │
│   │                                  │ │
│   │  ┌─────────────────────────────┐ │ │
│   │  │     Tentar novamente        │ │ │  ← Primary CTA — amber fill
│   │  └─────────────────────────────┘ │ │     Calls reset() from Next.js
│   │                                  │ │
│   │  → Fale com sua imobiliária      │ │  ← Secondary inline link
│   │                                  │ │     `mailto:` if agency known,
│   │                                  │ │     else hidden
│   │                                  │ │
│   │  Código: PAY_LOAD_FAILED         │ │  ← Mono evidence (error.digest)
│   │  Ref: 9c7e1d-2026-05-13          │ │     small, --color-text-2 (AA pass)
│   │                                  │ │
│   └──────────────────────────────────┘ │
│                                        │
├────────────────────────────────────────┤
│                                 pt|en  │  ← PublicFooterMeta (slim)
└────────────────────────────────────────┘
```

## Components used

| Slot | Component | Source |
|---|---|---|
| Shell | `PublicShell` + `PageContent variant="narrow"` | new + existing |
| Card | `Card` + `CardContent` | shadcn |
| Status badge | `PaymentStateTag state="error"` — new variant added to the existing component | existing (extend) |
| Primary CTA | `Button variant="default" size="lg"` calling `reset()` | shadcn |
| Secondary link | `<a href="mailto:…">` (if agency contact is reachable from cached query result; otherwise omitted) | semantic HTML |
| Error meta | `<Mono>` with `error.digest` (Next.js auto-generated) and a timestamp | existing |
| Footer | `PublicFooterMeta` (slim) | new |

## States

### Default — render

The error component receives `{ error, reset }` from Next.js. We:

1. Log `error` to Convex (or telemetry endpoint) with a useEffect: `useEffect(() => { sendError(error); }, [error]);` — fire-and-forget; not blocking
2. Render the layout above with the localized message
3. The `Código:` line surfaces the `error.digest` (Next.js auto-generates this; production-safe — does NOT reveal stack)

### Empty

Not applicable.

### Loading

`error.tsx` is itself a fallback. No loading state. (Next.js handles the streaming and renders this synchronously once a throw is caught.)

### "Persistent error" sub-state

If `reset()` is called and the same error throws again, Next.js re-renders this component with a fresh `error`. We track retry count in a `useState` and after 3 failed retries:

- The primary CTA is replaced with the secondary link as the only action: "Fale com sua imobiliária" becomes the primary amber CTA
- A new Mono line is added: "Tentamos 3 vezes." (en: "Tried 3 times.")

This pattern signals to the tenant that further automatic retries won't help.

## Interactions

| # | Trigger | Outcome |
|---|---|---|
| 1 | Tap "Tentar novamente" (primary CTA, retry count < 3) | Calls `reset()` from Next.js props; the segment re-renders. If query succeeds, this screen unmounts and the intended screen renders. |
| 2 | Tap "Tentar novamente" (retry count ≥ 3) | Disabled / replaced by escalation behavior (see above). |
| 3 | Tap "Fale com sua imobiliária" | `mailto:` opens the system mail client; if we don't have agency data, the link is hidden — fallback is a generic Mono line "Anote o código acima e procure a imobiliária." |
| 4 | Page refresh | Browser-level — bypasses `reset()` and re-runs the full RSC. May or may not succeed depending on the underlying error source. |
| 5 | Mount | `useEffect` fires telemetry once per error instance |

## Accessibility

### Tab order

1. Skip link → `#primary-action`
2. Locale switch
3. PaymentStateTag (non-focusable)
4. Primary CTA "Tentar novamente" (`id="primary-action"`)
5. Secondary link "Fale com sua imobiliária" (if rendered)
6. Mono error code (selectable text; not a link)

### Screen reader announcement order

1. "TGA"
2. Locale switch
3. "ERRO" (PaymentStateTag label)
4. "Não conseguimos carregar este pagamento" (`<h1>` inside card)
5. Inter body in full
6. "Tentar novamente, botão"
7. "Fale com sua imobiliária, link" (if shown)
8. "Código: PAY_LOAD_FAILED. Referência: 9c7e1d-2026-05-13"

The page wrap is `role="alert"` so the SR is interrupted to read the new content — error states warrant the assertive cadence per WCAG 4.1.3.

### Error code mapping

Convex returns `Result<TData, TError>` with structured `error.code`. The mapping:

```ts
// inside error.tsx
const t = useTranslations("paymentFlow.error");
const code = (error as Error & { code?: string }).code ?? "UNKNOWN";
const messageKey = `messages.${code}`;
const fallback = t("messages.UNKNOWN");
const message = t.has(messageKey) ? t(messageKey) : fallback;
```

Known codes (defined in `convex/payments/domain.ts` `PAYMENT_ERROR_CODE`):
- `LOAD_FAILED` — Convex query failed (network/outage)
- `INVALID_PUBLIC_ID` — publicId is malformed (caught earlier as 404; here only as edge case)
- `STELLAR_UNREACHABLE` — Horizon polling fell behind
- `UNKNOWN` — fallback

Each code has a unique pt-BR/en `messages.{CODE}` string. Never show the raw `error.message` to the tenant.

### Focus management

On mount, focus is moved to the `<h1>` inside the card via `useRef + useEffect(() => h1Ref.current?.focus(), [])` — the only screen in the flow that auto-focuses the heading. Justification: the user landed here NOT by their intent, but by a failure — the heading must announce immediately and set context. Per accessibility-patterns.md §3, this is the documented exception to "let the heading announce naturally."

The `<h1>` receives `tabindex="-1"` so it's focusable programmatically without becoming a Tab stop.

### Color contrast

Same as Screen 05. The amber CTA (`#C47E10` on `#1A1A1A` text) and the `#C94040` square are AA-compliant. The Mono error-code line uses `--color-text-2` (`#6B6860` on `#FFFFFF` = 4.5:1) — **WCAG AA pass**. Critique escalated this from `--color-text-3` (2.6:1, fails AA) — even though the line is supplementary metadata, the cost of meeting AA here is zero and ops still need to read the ref to triage.

### Touch targets

| Element | Hit area |
|---|---|
| Primary CTA | full-width × 48 (mobile); inline min-w-240 × 48 (tablet+) |
| Secondary link | full line-height ≥48 |
| Locale switch | 44×44 each anchor |

### Reduced motion

No motion on this screen.

## Image resources

| Slot | Type | Description | Treatment |
|---|---|---|---|
| No imagery | — | — | — |
| Arrow icon on secondary link "→" | Phosphor `ArrowRight` weight="light" 14px | Inline before link text | `aria-hidden="true"`, color `--color-text` |
| Brand mark | live text | Header | Geist Bold `#C47E10` |

**No illustrations of "broken pipes" / "lost connection" / "error robot."** The brand voice forbids cuteness on a failure surface.

## Three-layer hierarchy verification

| Layer | Element |
|---|---|
| Declaration (Geist Bold) | "Não conseguimos carregar este pagamento" `<h1>` |
| Explanation (Inter) | Body prose + CTA label + secondary link text |
| Evidence (Mono) | Error code + reference timestamp |

All three layers present. ✓ The evidence layer is critical here — error code becomes the value the tenant or imobiliária can use to debug.

## Brand-fidelity checklist

- ✓ `border-radius: 0` on all elements
- ✓ 1px solid borders only
- ✓ Amber under 5%: wordmark + CTA fill = ~2.4%
- ✓ Three-layer hierarchy present (declaration / explanation / evidence — evidence is the error code)
- ✓ No shadows, gradients, glass
- ✓ Tabular-nums on error reference timestamp (`Mono`)
- ✓ Effects vocabulary: only CTA hover (background-color 150ms ease-out)
- ✓ `#1A1A1A` on `#C47E10` AA-compliant
- ✓ Error red `#C94040` used semantically (badge only), never decoratively
- ✓ Bold-bet #1 (zero radius): all
- ✓ Bold-bet #2 (amber): minimal
- ✓ Bold-bet #3 (tabular nums): error code + reference
- ✓ Bold-bet #4 (three-layer): verified
- ✓ Bold-bet #5 (surface stacking): card on canvas

## Anti-patterns avoided

- No "Ops!" / "Algo deu errado!" — voice rule
- No emoji
- No illustration of "broken state"
- No raw stack trace exposed
- No "Detalhes técnicos" disclosure with exposed internals
- No retry-with-spinner — the button just re-fires `reset()`; if it succeeds, the page changes; if it fails, the error re-renders
- No color-only state cue (badge has the redundant label)

## Implementation note

```tsx
// app/[locale]/(public)/pagar/[publicId]/error.tsx
"use client";
import { useEffect, useRef } from "react";
import { useTranslations } from "next-intl";
// ... (additional imports omitted)

export default function PaymentFlowError({
  error,
  reset,
}: { error: Error & { digest?: string; code?: string }; reset: () => void }) {
  const t = useTranslations("paymentFlow.error");
  const h1Ref = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    sendErrorTelemetry(error);
    h1Ref.current?.focus();
  }, [error]);

  const code = error.code ?? "UNKNOWN";
  // ... render the layout
}
```

## Related

- Components: see `shared/component-plan.md` (`PaymentErrorBoundary`, `PaymentStateTag` extension)
- Brand patterns: STYLE.md §3.1, §3.5
- Microcopy: research/content-strategy.md "Expired / canceled / error screens" block — "error (load)" and "error (submit Stellar)" rows
- Accessibility: research/accessibility-patterns.md §3 (focus management — heading-focus exception), §5 (`role="alert"`)
- Next.js 16 error.tsx convention: research/reference-specs.md §8
- Result + Error code mapping: research/reference-specs.md §10
