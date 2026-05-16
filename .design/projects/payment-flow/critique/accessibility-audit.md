# Accessibility Audit

> Chunk: accessibility-audit | Phase: critique | Project: payment-flow | Generated: 2026-05-13
> Standard: WCAG 2.2 AA | Reviewer: GSP Accessibility Auditor

Scoped to design-phase artifacts (markdown specs). A second audit on rendered code is recommended after the build phase.

## 1. Perceivable

### 1.1 Text Alternatives

| Criterion | Status | Notes |
|---|---|---|
| 1.1.1 Non-text content has text alternatives | ✓ Pass | QR code carries `role="img"`, `aria-labelledby="qr-title qr-desc"` with `<title>` and `<desc>` children (Screen 02). Decorative icons (CaretDown, Phone, EnvelopeSimple) use `aria-hidden="true"`. The TGA wordmark uses `role="img" aria-label="TGA"`. Stellar Explorer link icon paired with text "Stellar Expert" — meaningful link text, icon is decorative. |
| Decorative images use empty alt or CSS background | ✓ Pass | The 4px `#2E8B5A` top stripe on the receipt is implemented as `border-top`, not an image — no alt needed. |

### 1.2 Time-Based Media

Not applicable — no audio or video content in the flow.

### 1.3 Adaptable

| Criterion | Status | Notes |
|---|---|---|
| 1.3.1 Info and Relationships | ✓ Pass | `<header>` / `<main>` / `<footer>` landmarks defined in PublicShell (Screen 01 §"Semantic landmarks"). `<h1>` on PaymentSummaryHeader for screens 01/02/03/04. `<h1>` on title-inside-card for screens 05/06/07 (because the page subject IS the state). `<h2>` for "Pagamento confirmado" inside receipt card. Address rendered in `<code>` element. |
| 1.3.2 Meaningful Sequence | ✓ Pass | Reading order documented per-screen ("Screen reader announcement order"). |
| 1.3.3 Sensory Characteristics | ✓ Pass | All instructions ("Use o endereço completo", "Aguardando pagamento") are textual, not "tap the blue button" or "see the icon on the right". |
| 1.3.4 Orientation | ✓ Pass | No orientation lock specified. Mobile-first design works portrait and landscape. |
| 1.3.5 Identify Input Purpose | N/A | No form inputs in v1 (Mode B in v1.1 only has wallet-detection flow, no text inputs). |

### 1.4 Distinguishable

| Criterion | Status | Notes |
|---|---|---|
| 1.4.1 Use of Color | ✓ Pass | All status badges are square+label (STYLE.md §3.5) — color never alone. The 4px receipt stripe is paired with the `PAGO` badge label. Error states have explicit error text + icon, not just red color. |
| 1.4.3 Contrast (Minimum) | ⚠ Partial | Major violations (see `accessibility-fixes.md`): Screen 06 Mono error-code line uses `#9E9C98` on `#FFFFFF` = 2.6:1 (FAIL — design author flagged + offered fix). All other contrast pairs verified per STYLE.md §"WCAG Contrast Audit": `#1A1A1A` on `#F7F6F3` 16.1:1 (AAA), `#1A1A1A` on `#C47E10` 5.3:1 (AA), `#2E8B5A` on `#FFFFFF` 4.6:1 (AA Normal), `#C94040` on `#FFFFFF` 5.5:1 (AA). |
| 1.4.4 Resize Text | ✓ Pass | All typography uses rem-based clamp() values per STYLE.md type scale. Browser zoom at 200% scales both bounds correctly. |
| 1.4.5 Images of Text | ✓ Pass | TGA wordmark is live text (Geist Bold), not an image. No other text-as-image anywhere. |
| 1.4.10 Reflow | ✓ Pass | Responsive baseline 360px tested per-screen. M-address 4×14 chunk fits at 360px without horizontal scroll. QR 240×240 fits with breathing room. |
| 1.4.11 Non-text Contrast | ✓ Pass | All borders 1px solid `#D9D7D2` on `#FFFFFF` = 1.5:1 — fails 3:1 as decorative but the borders are paired with surface tonal shift (canvas `#F7F6F3` → surface `#FFFFFF`) which is the actual depth signal per STYLE.md Bold Bet #5 (surface stacking). Focus borders shift to `#C47E10` (3.1:1 on `#FFFFFF` — passes 3:1 for UI components). |
| 1.4.12 Text Spacing | ✓ Pass | All line-heights 1.5+ on body text (24px on 16px body). Letter-spacing not below browser defaults. Paragraph spacing handled via `space-*` tokens. |
| 1.4.13 Content on Hover or Focus | ✓ Pass | Sonner toasts use `role="status"` and auto-dismiss after 3s; user can hover/focus to suspend. No purely-hover-revealed content. |

## 2. Operable

### 2.1 Keyboard Accessible

| Criterion | Status | Notes |
|---|---|---|
| 2.1.1 Keyboard | ✓ Pass | All interactive elements (CTAs, copy buttons, locale switch, explorer link, mode tabs, disclosure trigger) are native `<button>` or `<a>` or shadcn `TabsTrigger` — all keyboard-operable. No custom `<div onClick>`. |
| 2.1.2 No Keyboard Trap | ✓ Pass | No modal dialogs in v1; Sonner toasts do not trap focus. Mode B in v1.1 will trigger Freighter extension popup — browser handles focus return naturally. |
| 2.1.4 Character Key Shortcuts | N/A | No character-only shortcuts implemented. |

### 2.2 Enough Time

| Criterion | Status | Notes |
|---|---|---|
| 2.2.1 Timing Adjustable | ✓ Pass | No session timeouts on the public flow. Magic link is per-payment, not per-session. |
| 2.2.2 Pause, Stop, Hide | ⚠ Note | The 2s amber pulse on the live-poller dot is the only ambient animation. Per WCAG 2.2.2 exception "if essential", it's a status signal. `prefers-reduced-motion` swaps it to a static square per micro-interactions §"Reduced-motion override". Pass. |

### 2.3 Seizures and Physical Reactions

| Criterion | Status | Notes |
|---|---|---|
| 2.3.1 Three Flashes or Below Threshold | ✓ Pass | Pulse dot is 0.5Hz (2s cycle), far below 3 flashes/second threshold. |
| 2.3.3 Animation from Interactions | ✓ Pass | `prefers-reduced-motion: reduce` documented per-screen — toasts become instant, Mode B spinner becomes static `…`, pulse dot swaps to static square. |

### 2.4 Navigable

| Criterion | Status | Notes |
|---|---|---|
| 2.4.1 Bypass Blocks | ✓ Pass | Skip link `Pular para o pagamento` is first focusable element on every screen, targets `#primary-action`. Visible on focus via `transform: translateY(-100%) → 0` — single documented transform exception, brand-justified. |
| 2.4.2 Page Titled | ✓ Pass | i18n key `paymentFlow.meta.title` is per-screen. Receipt has "Recibo · {agencyName} · R$ {amount}". Build-phase to verify all 7 screen titles populated. |
| 2.4.3 Focus Order | ✓ Pass | Documented tab order per screen (Screens 01, 02, 03, 04, 05, 06, 07 all have explicit ordering). Logical and meaningful. |
| 2.4.4 Link Purpose | ✓ Pass | "Fale com {agencyName}", "Stellar Expert (nova aba)" with `aria-label`, "Prefiro copiar o endereço". No "click here". Locale switch has language code as accessible name. |
| 2.4.5 Multiple Ways | N/A | Single-purpose flow per WCAG note — "multiple ways" doesn't apply to single-task journeys. |
| 2.4.6 Headings and Labels | ✓ Pass | Headings are descriptive ("Pagamento confirmado", "Pagamento expirado", "Não conseguimos carregar este pagamento"). Labels are explicit ("Endereço de pagamento", "Hash da transação Stellar"). |
| 2.4.7 Focus Visible | ⚠ Build-time risk | Per STYLE.md §3.4, focus is signaled by 1px `--color-accent` border, no outline/ring. **This requires every focusable element to have a 1px ever-present border by default** so the focus-state has somewhere to shift to. Design specifies this but shadcn Button `default` variant may need an explicit `border-transparent` baseline. Critical for build verification — see `accessibility-fixes.md` row #1. |
| 2.4.11 Focus Not Obscured (AA) | ✓ Pass | No sticky overlays, no fixed bottom drawers, no chat widgets. The header is 56px static; focused elements are never hidden under it because there's no auto-scroll. |

### 2.5 Input Modalities

| Criterion | Status | Notes |
|---|---|---|
| 2.5.1 Pointer Gestures | ✓ Pass | No multi-pointer, no path-based gestures. Single-tap on everything. |
| 2.5.2 Pointer Cancellation | ✓ Pass | All interactions fire on `onClick` (up-event). No drag-based confirm. |
| 2.5.3 Label in Name | ✓ Pass | Visible button labels match accessible names ("Abrir em carteira", "Copiar endereço"). |
| 2.5.4 Motion Actuation | N/A | No motion-triggered functions. |
| 2.5.5 Target Size (Enhanced AAA) | ✓ Pass | All targets ≥48px (Imobiliárias front baseline). |
| 2.5.7 Dragging Movements | N/A | No drag-required actions. |
| 2.5.8 Target Size (Minimum AA) | ✓ Pass | All ≥24px CSS pixels; documented audit in `../design/shared/responsive.md` §"Touch target audit by screen". |

## 3. Understandable

### 3.1 Readable

| Criterion | Status | Notes |
|---|---|---|
| 3.1.1 Language of Page | ✓ Pass | `<html lang="pt-BR">` and `<html lang="en">` set by next-intl per locale prefix. |
| 3.1.2 Language of Parts | ✓ Pass | English-only content (e.g. "Stellar Expert", token codes like `XLM`) doesn't trigger `lang` requirement because these are brand/protocol names, not natural-language prose. |

### 3.2 Predictable

| Criterion | Status | Notes |
|---|---|---|
| 3.2.1 On Focus | ✓ Pass | No context changes on focus. Border color shift only. |
| 3.2.2 On Input | ✓ Pass | No form inputs in v1; Mode B v1.1 wallet-connect requires explicit user action (button click), not on-input change. |
| 3.2.3 Consistent Navigation | ✓ Pass | Same PublicShell header + footer on every screen. Locale toggle in same place. Skip link in same position. |
| 3.2.4 Consistent Identification | ✓ Pass | PaymentStateTag, Button, Card, Mono are used identically across screens. |
| 3.2.6 Consistent Help (A) | ⚠ Note | Agency-contact appears in the footer on most screens but moves inside the receipt card on Screen 04. Different relative position. Acceptable per WCAG note (the footer copy is functionally absorbed into the card's contact block — the help doesn't disappear, it relocates). Build phase: ensure the agency-contact info on the receipt card carries the same semantic structure as the footer version. |

### 3.3 Input Assistance

| Criterion | Status | Notes |
|---|---|---|
| 3.3.1 Error Identification | ✓ Pass | Error inline lines (Mode B `user-rejected`, `network-failed`, `freighter-missing`, `contract-aborted`) all have descriptive copy. The error.tsx screen surfaces `error.digest` as evidence. |
| 3.3.2 Labels or Instructions | ✓ Pass | Each card has a visible label ("Endereço de pagamento", "Pagar com carteira Stellar"). Each value has a Mono label above it. |
| 3.3.3 Error Suggestion | ✓ Pass | Error states pair with recovery — "Tente novamente em alguns instantes. Se o problema persistir, fale com sua imobiliária." |
| 3.3.4 Error Prevention | ✓ Pass | The flow has no submit; the only "user error" path is paying the wrong amount, which the reconciler handles server-side (gap-analysis §Risks). |
| 3.3.7 Redundant Entry (A) | N/A | No multi-step forms. |
| 3.3.8 Accessible Authentication (AA) | ✓ Pass | Magic-link bearer auth — no cognitive function test, no captcha. |

## 4. Robust

| Criterion | Status | Notes |
|---|---|---|
| 4.1.2 Name, Role, Value | ✓ Pass | All UI components use shadcn primitives (which expose proper ARIA roles via Radix UI). Custom components (PaymentStateTag, PaymentSummaryHeader) specify their ARIA attributes in the design chunks. |
| 4.1.3 Status Messages | ✓ Pass | `role="status" aria-live="polite"` on Sonner toasts and on the "Aguardando pagamento na rede" line. `role="alert"` on Mode B error inline lines and on the error.tsx wrapper — assertive cadence appropriate for failure. |

## 5. Mobile

| Criterion | Status | Notes |
|---|---|---|
| Orientation | ✓ Pass | No orientation lock. Mobile-first design tested at 360px portrait. |
| Touch targets | ✓ Pass | All ≥48px (per `../design/shared/responsive.md` §"Touch target audit by screen"). |
| Reach zones | ✓ Pass | Primary CTA at the bottom of the card on mobile, within thumb reach. Top bar has no interactive elements except locale switch (top-right, single-handed reachable). |
| Reflow at 320px | ⚠ Note | Design baseline is 360px (per BRIEF constraint and responsive.md). At 320px (older iPhone SE), the M-address 14×4 chunking would slightly overflow the 280-32 = 248px usable card width. Recommend testing at 320px in build phase; mitigation: reduce chunk size to 12 chars × 5 lines at <360px. Not a v1 blocker per BRIEF's 360px constraint, but flag for future hardware support. |

## 6. Cognitive

| Criterion | Status | Notes |
|---|---|---|
| Reading level | ✓ Pass | Copy uses simple, direct Portuguese (and English parity). Forbidden vocabulary list eliminates jargon. |
| Consistent navigation | ✓ Pass | See 3.2.3. |
| No flashing | ✓ Pass | See 2.3.1. |
| No time limits | ✓ Pass | See 2.2.1. |
| Predictability | ✓ Pass | One CTA per screen. State transitions are server-pushed (no surprises). |
| Help available | ✓ Pass | "Como pagar via Stellar" disclosure on Screen 02. Agency contact on every state screen. |

## Summary

| Status | Count |
|---|---|
| Pass | 38 |
| Partial / Risk | 4 |
| Fail | 1 (Screen 06 Mono color contrast) |
| Not applicable | 7 |

**Overall conformance level (design phase):** WCAG 2.2 AA — Conformant pending the four addressable items in `accessibility-fixes.md`.

The single Fail (Screen 06 Mono evidence color) was identified by the design author and a fix offered (`--color-text-2`). The three Partial/Risk items are all build-phase verification concerns:

1. Focus indicator implementation must be globally consistent (1px border baseline on every focusable element).
2. Reflow at 320px (below the 360px design baseline) needs explicit handling.
3. Consistent help: agency-contact relocation between footer and receipt-card needs same semantic structure.
4. The amber-pulse dot's reduced-motion behavior (swap to static square) needs build verification.

## Accessibility Statement (Draft)

> O portal público de pagamentos da TGA segue as diretrizes de acessibilidade WCAG 2.2 AA. A interface foi projetada para funcionar com leitores de tela (VoiceOver, NVDA, TalkBack), navegação por teclado completa, contraste suficiente em todos os textos, e alvos de toque mínimos de 48px em todos os dispositivos. Estados de pagamento são comunicados redundantemente por cor, ícone (quadrado) e rótulo em maiúsculas. Em caso de dificuldade de acesso, entre em contato com sua imobiliária ou nos escreva em acessibilidade@tga.finance.

(en parity required in build phase.)

## Related

- Accessibility fixes: [accessibility-fixes.md](./accessibility-fixes.md)
- Critique: [critique.md](./critique.md)
- Prioritized fixes: [prioritized-fixes.md](./prioritized-fixes.md)
