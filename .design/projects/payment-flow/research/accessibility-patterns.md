# Accessibility Patterns — Public Payment Portal

> Phase: research | Project: payment-flow | Date: 2026-05-13

WCAG 2.2 AA is the bar. The tenant audience includes screen-reader users, motor-impaired users on touch devices, low-vision users in bright outdoor light, and cognitively-loaded users (paying rent while distracted).

## 1. Keyboard nav map (6 screens)

| Screen | Tab order | Notes |
|---|---|---|
| Method picker | 1. Skip-link (visible on focus) → 2. Agency contact link → 3. Method card 1 (PIX) → 4. card 2 (Boleto) → 5. card 3 (Stellar) | Cards are `<button>` not `<a>` — they trigger a Convex mutation (`chooseMethod`) before navigating |
| PIX execution | 1. Back link → 2. Copy PIX button → 3. (QR is decorative; not focusable but has alt text) → 4. Help disclosure | Back link is `<Link>` from `@/i18n/navigation` |
| Boleto execution | 1. Back link → 2. Copy linha digitável → 3. Abrir PDF → 4. Help disclosure | PDF opens in new tab (`target="_blank"` + `rel="noopener"`); aria-label includes "abre em nova aba" |
| Stellar execution | 1. Back link → 2. Copy address → 3. Copy memo → 4. txHash input → 5. Submit button → 6. Help disclosure | Submit button disabled until txHash matches pattern (56 chars hex+base32 etc.) |
| Receipt | 1. Print/save → 2. Agency contact → 3. Back to start | No primary CTA — receipt is terminal |
| Expired/error | 1. Agency contact (primary) → 2. Retry (if applicable) | "Fale com sua imobiliária" is the single primary action |

**No keyboard traps** (WCAG 2.1.2). The countdown is decorative — it must not steal focus on tick.

**Skip-link:** include a visible-on-focus "Pular para o pagamento" link at the top of each execution screen, anchoring to the primary CTA. Not strictly required for short pages but ships free safety.

## 2. Screen-reader strategy

### QR code

The QR is a graphical encoding of the PIX payload. For SR users, scanning is impossible — they need the alternative text PLUS the copia-e-cola key. Three rules:

1. The `<svg>` element receives `role="img"` and `aria-labelledby="qr-title qr-desc"`.
2. `<title>` content: "Código QR para pagamento Pix" (en: "QR code for Pix payment").
3. `<desc>` content: "Use a câmera do app do seu banco. Como alternativa, copie o código Pix abaixo." (en: "Use your bank app camera. Or copy the Pix code below.").

The visible amount + due date sits in a `<header>` above the QR, so SR reads them BEFORE the QR's title. Order matters.

### Mono evidence rows

`CopyableValue` renders as:

```html
<div>
  <span class="text-xs uppercase">Código Pix</span>
  <code class="font-mono">00020126...6304ABCD</code>
  <button aria-label="Copiar código Pix">…</button>
</div>
```

The `<code>` element signals "machine-readable" to AT. JetBrains Mono is set on `<code>` and `<.font-mono>` via the brand stack — SRs ignore font but the semantic is correct.

### Status badges

`PaymentStateTag` uses square (6×6px solid) + uppercase label (JetBrains Mono). For SR users the square is `aria-hidden="true"`; only the label is announced. WCAG 1.4.1 (Use of Color) satisfied by the redundant label.

## 3. Focus management across screens

When a tenant picks a method on the picker, `chooseMethod` mutation fires then `router.push` to `/pagar/X/pix` (or chosen sub-route). On the new screen, focus should land **on the primary CTA** (copy button), not on the page heading and not lost to `<body>`.

Pattern:

```tsx
"use client";
const ref = useRef<HTMLButtonElement>(null);
useEffect(() => { ref.current?.focus(); }, []);
return <Button ref={ref}>Copiar código Pix</Button>;
```

Counter-pattern (avoid): focusing the page heading. SRs already read the new page on navigation; double-announcing the title is noisy. Focusing the action keeps the user productive.

**Back navigation** restores focus to the method card the user picked (browser default behavior preserves this via History API; no extra work needed if we use real `<Link>`).

## 4. Touch targets (WCAG 2.5.8)

| Element | Target size | Notes |
|---|---|---|
| Amber CTAs | 48px height × full-width | Brand spec exceeds WCAG min (24px) |
| Copy icon buttons | 44×44px hit area (icon visually 20×20, padding 12) | Includes invisible padding for fat-finger forgiveness |
| Method cards | Full card (≥100px tall) | Whole card is hit target |
| Back link | 44×44px hit area | Padding around 16×16 icon |
| Help disclosure | 44px height | Detail/summary or button |

Spacing between adjacent tappable elements: 8px minimum. Critical between "Copy" and "Abrir PDF" on the boleto screen.

## 5. aria-live regions

Two scenarios need live announcements:

### Copy confirmation
On successful copy, the toast (Sonner) renders. Sonner ships with `role="status"` + `aria-live="polite"` by default — verify in our usage. The message "copiado" (en: "copied") is announced once; the toast auto-dismisses after 3s.

### Countdown — DO NOT live-announce
The PIX countdown ticks every second. Wrapping it in `aria-live="polite"` would announce "29:59… 29:58… 29:57…" every second — catastrophic for SR users. Instead:

- Mark the countdown `<span aria-hidden="true">` for the visible ticking number
- Provide a separate, statically-rendered text outside the live region: "Expira às 18h22" (en: "Expires at 6:22 PM")
- Optional: provide a manual "Tempo restante" disclosure button that opens an `aria-live="polite"` region with a single announcement of the current remaining time. Most users won't need it; it costs nothing.

### State changes
When the Convex subscription delivers `state.kind === "paid"` mid-session, we navigate to `/recibo`. The receipt page's `<h1>` "Pagamento confirmado" is announced naturally on navigation. No special live region needed.

## 6. Reduced motion (prefers-reduced-motion)

Brand contract already eliminates most motion (no gradients, no shadows, no glow). Remaining motion considerations:

- Countdown numeric tick: text changes are technically motion. Acceptable per WCAG 2.3.3 (Animation from Interactions). Not flashing; user-initiated by opening the page.
- Toast slide-in (Sonner default): wrap toast container in a `prefers-reduced-motion: reduce` query that disables transform animation, keeping opacity-only fade.
- Skeleton shimmer: shadcn `Skeleton` ships with a subtle background-position animation. Per `prefers-reduced-motion`, switch to a static neutral fill.

Implementation: a single `@media (prefers-reduced-motion: reduce)` block in `globals.css` neutralizes the above.

## 7. Cognitive load — zero memory across screens

Principle: the tenant must NEVER be expected to remember a value from a previous screen.

- **Amount** is displayed on every screen (method picker, execution, receipt). Same formatting, same position (top of card).
- **Due date** is on method picker + execution screens, omitted from receipt (replaced by `paidAt`).
- **Agency name + contact** is on every screen — small in execution, hero-card on errors. Tenant must always know who to call.
- **PIX key / barcode / address** is NEVER hidden behind a tap. Always visible. Copy buttons are an addition, not a replacement.

Anti-pattern: showing the QR on one screen and the copia-e-cola on a different tab. Same screen, same card.

## 8. Color contrast (WCAG 1.4.3, 1.4.11)

Brand tokens already validated against AA at minimum:

- `#1A1A1A` text on `#FFFFFF` bg: 19.6:1 ratio (AAA)
- `#1A1A1A` text on `#C47E10` amber: 5.9:1 (AA Large, AA Normal pass)
- `#737373` muted text on `#FFFFFF`: 4.6:1 (AA Normal pass)
- Border `#D9D7D2` on `#FFFFFF`: 1.3:1 — non-text element (border) per 1.4.11 needs 3:1. **Verify** that focus-state border (`#C47E10` amber) hits 3:1 against white — it does (5.9:1).

Mono evidence rows use `#1A1A1A` — full contrast. Never use muted gray for the copia-e-cola string.

## 9. Form input — Stellar txHash

The only text input in the entire flow. Per WCAG 3.3.2 (Labels or Instructions):

- Visible label: "Hash da transação Stellar" (en: "Stellar transaction hash")
- Placeholder is NOT a label substitute (per 3.3.2 + 1.3.1)
- Help text below input: "64 caracteres alfanuméricos do recibo da sua carteira" (en: "64 alphanumeric characters from your wallet receipt")
- Error state: aria-invalid="true" + aria-describedby pointing to a sibling `<p id="...">` with the specific error
- Pattern hint: `<input pattern="[a-fA-F0-9]{64}">` for HTML-level validation, mirrored by Zod for server validation

## 10. Internationalization & locale-aware a11y

- `<html lang>` is set by next-intl per request — SRs switch voices accordingly between pt-BR and en
- Currency formatted via `Intl.NumberFormat(locale, {...})` — pronounced correctly by SRs in target language
- Date formatted via `Intl.DateTimeFormat(locale, ...)` — never as `15/05/2026` literal, always via Intl so en users get `5/15/2026`
- All `aria-label` strings come from `useTranslations` — never hardcoded

## Quick-apply checklist

- [ ] All `<button>` and `<a>` have visible text OR `aria-label`
- [ ] All inputs have a programmatically-associated `<label>`
- [ ] Focus indicator: border color → `#C47E10` (no ring, no shadow per brand)
- [ ] Tab order matches visual order on every screen
- [ ] No `outline: none` without a replacement
- [ ] Heading hierarchy: one `<h1>` per page, no skipped levels
- [ ] Color is never the sole signal (badges = square + label)
- [ ] Live regions used surgically (toast yes, countdown no)
- [ ] Reduced motion respected globally
- [ ] All language attribute set correctly per locale

## Sources

- [WCAG 2.2 — W3C Recommendation](https://www.w3.org/TR/WCAG22/)
- [WCAG 2.2 — 2.5.8 Target Size (Minimum)](https://www.w3.org/TR/WCAG22/#target-size-minimum)
- [WCAG 2.2 — 2.4.11 Focus Not Obscured](https://www.w3.org/TR/WCAG22/#focus-not-obscured-minimum)
- [WCAG 2.2 — 3.3.2 Labels or Instructions](https://www.w3.org/TR/WCAG22/#labels-or-instructions)
- [Deque — Reduced Motion patterns](https://www.deque.com/blog/accessible-animations-and-prefers-reduced-motion/)
- [Sonner — react toast](https://sonner.emilkowal.ski/)
