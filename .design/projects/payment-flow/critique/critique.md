# Critique

> Chunk: critique | Phase: critique | Project: payment-flow | Generated: 2026-05-13
> Reviewer: GSP Design Critic (Apple Design Director lens)

## Strategy alignment

**Verdict: Strong.** The design serves the brief with discipline. BRIEF.md asks for "trust in 2 seconds" on a tenant-facing public surface where most users (Camila) have never seen TGA. The design honors this with three concrete moves:

1. **PaymentSummaryHeader as universal anchor** — agency + amount + due date on every screen guarantees Camila never has to scroll to confirm what she's paying. (S1, S4 in BRIEF.)
2. **Mode A as the default** — the SEP-7 address + QR + "Abrir em carteira" trio is wallet-agnostic and demands no learning. The non-goal "no wallet kit on client" is honored; `@stellar/freighter-api` is gated behind a flag and a dynamic island.
3. **Receipt with verifiable proof** — txHash, ledger #, and `stellar.expert` link satisfy S5/S8 and serve Daniel's evidence-need without taxing Camila.

The scope-narrowing decision (Stellar-only v1, defer PIX/Boleto) is well-tracked in STATE.md. The screens deliver exactly what the brief asks for and the v1.1 scaffolding (Mode B + tab toggle) is built into the IA so it lands without re-design.

**One soft alignment gap:** the brief promises that "Trust must be earned in the first 2 seconds." Screen 02 mobile (the v1 hero) renders QR → asset amount → 56-char M-address → secondary CTA → primary CTA → poller — that's six content blocks before the page settles. Visually composed well, but on a 360px viewport this is a long scroll for "I just want to pay." See Critical fix #1.

## Brand contract

STYLE.md was provided. Scored against the five dimensions:

| Dimension | Score | Notes |
|---|---|---|
| Constraint adherence | 5 | Per-screen `border-radius: 0` and 1px-solid borders verified. No shadows, no gradients, no glass anywhere. The single transform-on-focus skip link is correctly called out as the documented exception (WCAG 2.4.1). Effects vocabulary stays inside `color`/`background-color`/`border-color`/`opacity`. |
| Pattern fidelity | 5 | Card, Button (primary amber fill + dark text per Imobiliárias column), Badge (square + label), Separator (1px, 0 radius), Input (none used) all match STYLE.md §3 tables. `#1A1A1A` on `#C47E10` is consistently chosen for amber CTAs — the most-violated rule in TGA shadcn adoptions is correctly avoided. |
| Effects vocabulary | 5 | The pulse dot (animation #9), state-machine button on Mode B (opacity-only trailing dots), Sonner opacity-only fade, and 150ms hover transitions are all inside vocabulary. The Mode B "spinner" is explicitly three opacity-cycled amber squares, not a CSS rotation — exemplary discipline. |
| Intensity calibration | 4 | Variance:3 / Motion:2 / Density:6 dials are honored: structured, minimal motion (one ambient pulse), data-dense on receipt. **Minor concern:** Density:6 is the dial for the system average; the public payment portal arguably reads ~5 (light, single-purpose), but no STYLE.md constraint is broken — just a slight register mismatch with the imobiliárias front being inherently lighter. Not a fix; a note. |
| Bold bet presence | 5 | All five bold bets land. (1) zero-radius is comprehensive. (2) amber-pixel math is performed per screen, all under 5% — receipt is the cleverest, dropping CTA amber entirely so success-green can own the moment. (3) `<Mono>` everywhere on numerics. (4) three-layer hierarchy verified per screen with explicit Geist/Inter/Mono mapping. (5) surface stacking — receipt's 4px stripe is documented STYLE.md §3.1 pattern, not an invented decoration. |

**Total: 24/25.** Brand contract is exceptionally honored. No constraint violations (no dimension at 1). The design clearly read STYLE.md as binding.

**STYLE-tagged concern (single):** Screen 07's three-layer hierarchy compliance is technically met via the badge Mono label, but it's a stretch. The design author flagged this themselves ("the critique phase may push back on the thinness of the evidence layer here") and offered a fix (add `Ref: {timestamp}`). Recommend taking the offered fix — see prioritized-fixes.

## Usability — Nielsen's 10

| # | Heuristic | Score | Rationale |
|---|---|---|---|
| 1 | Visibility of system status | 5 | Live pulse dot + Mono "Aguardando pagamento na rede" line is the textbook implementation of ambient status. Wallet mode state machine (idle → signing → submitting → confirming → done) gives clear feedback at every step. Receipt's status badge + paidAt + ledger # leave zero ambiguity. |
| 2 | Match between system and the real world | 5 | Forbidden-vocabulary list ("blockchain", "onchain", "smart contract", "token") is enforced in copy planning. CTAs are imperative + specific (`Abrir em carteira`, `Copiar endereço`) — never `Continuar` or `OK`. Currency formatted via `Intl.NumberFormat('pt-BR')`. Dates as `DD/MM/YYYY`. Phone as `+55 11 9 8765-4321`. |
| 3 | User control and freedom | 4 | Browser back covers most cases; idempotent forward-loop on `/recibo` prevents stuck states. No "Voltar" button is justified (single-purpose flow). **Minor gap:** on Mode A, if Camila accidentally hits "Abrir em carteira" but doesn't have a Stellar wallet installed, nothing happens (the SEP-7 deep link falls through silently). Screen 02 §"Interactions" row #2 acknowledges this but the user is left without feedback. See Important fix #1. |
| 4 | Consistency and standards | 5 | `PaymentSummaryHeader` reused across 01/02/03/04/05 is the consistency engine. PaymentStateTag extended with new variants (overdue, canceled, notFound, error, paid) rather than reinventing badges. Print stylesheet handled consistently. Navigation patterns (locale switch, skip link, footer meta) repeat exactly. |
| 5 | Error prevention | 4 | The `M…`-vs-`G…` confusion (tenant accidentally pasting the bare Mutav address) is acknowledged in gap-analysis. The reconciler handles it server-side, but the UI doesn't preempt the mistake. Mode A copy says "Use o endereço completo" — could be more visually emphatic. **Bigger gap:** amount precision — XLM displays as `124,7805` (4-decimal) but Stellar supports 7. If tenant truncates while typing manually, payment under-fills. The copy button addresses this (it copies the unbroken precise value), but tenants who type the amount into their wallet's "send" field could miss decimals. See Important fix #2. |
| 6 | Recognition over recall | 5 | Three convenience tiers (scan / deep-link / copy) on Screen 02 mean Camila never has to remember any state across screens. The QR is the address — recognize, don't recall. The receipt's `stellar.expert` link prevents Daniel from having to remember the txHash to verify. |
| 7 | Flexibility and efficiency of use | 4 | Skip link, three execution paths, locale toggle, copy primitives are efficient for power users. **Gap:** No keyboard shortcut for copy (Ctrl/Cmd+C with focus on the address `<code>`); the copy button is the only path. Power-user Daniel selects the text and uses native copy — which works (long-press / select isn't overridden), but a `data-copy` attribute or a native `<button>` focus trap on the address would be tighter. Minor. |
| 8 | Aesthetic and minimalist design | 5 | This is the design's strongest dimension. The receipt deliberately drops amber to let success-green own the moment. The not-found screen omits PaymentSummaryHeader because there's no payment data — refusing to show empty chrome. Footer is stripped of "Dúvidas?" on receipt because the agency-contact block lives inside the card now. Every screen has *one* primary action. No decoration anywhere. The voice rule "no celebration" produces a receipt that feels institutional, not a SaaS toast. |
| 9 | Help users recognize, diagnose, recover from errors | 4 | `error.tsx` (Screen 06) renders error.digest as evidence so Lucas can debug. Error code → message-key mapping is in place. Escalation pattern after 3 retries (replace retry with agency contact) shows real thought. **Gap:** Mode B `freighter-missing` error sends tenant to install Freighter — but Camila will never install Freighter; that error variant should default-recommend the address fallback ("Prefiro copiar o endereço") as the primary action instead of as the secondary link. See Important fix #3. |
| 10 | Help and documentation | 4 | "Como pagar via Stellar" Collapsible carries 5 numbered steps inline; "Como pagar com carteira" carries 4 on Mode B. No external doc-site links — appropriate for the public surface. **Gap:** the Collapsible defaults closed; on a first-time tenant flow, a discoverable but not-pre-opened help section is a UX hedge. Consider an above-the-fold heuristic: if `payment.tenantSeenBefore !== true` (cookie or `localStorage`), default the disclosure open. Polish, not Important. |

**Total: 45/50.** Solidly Pass-tier. The four 4-scores are all addressable in v1 without re-design; #3, #5, #9 have concrete remediations in prioritized-fixes.

## Accessibility

Detailed audit is in `accessibility-audit.md`. Summary from the critic's perspective:

- The focus-indicator strategy (1px amber border, no ring/glow) is brand-correct and accessibility-correct *if implemented faithfully*. The 1px border-color shift must apply to every focusable element. Screen 02 row 12 (focus on CTA via `border-color`) is the canonical reference — the implementation needs to make `outline: none` + a 1px ever-present border the global default for every focusable element.
- **The error.tsx Mono color is below AA** (`#9E9C98` on `#FFFFFF` = 2.6:1 — Screen 06 §"Color contrast"). The design author calls this out and offers `--color-text-2` as the escalation. Take the offered fix.
- The QR code's `<title>` + `<desc>` pattern is exemplary. The `<code>` element with `aria-label` carrying the full unbroken Stellar address (so SR reads it once, not four times) is one of the design's most thoughtful accessibility decisions.
- Touch targets all ≥48px (Imobiliárias front baseline) exceed WCAG 2.5.8 (24×24) and the 44×44 mobile recommendation.

See `accessibility-fixes.md` for the violations table.

## Content quality

- **Voice is consistent and brand-true.** No "Ops!", no exclamation marks, no "Obrigado pelo pagamento!" The receipt's voice — "Pagamento confirmado" + Mono evidence — is the brand's single best content moment.
- **Microcopy is authored.** Every state has explicit copy (idle → signing → submitting → confirming → done). Empty states are designed up front (S10 in BRIEF). Error inline lines distinguish `user-rejected`, `network-failed`, `contract-aborted`, `freighter-missing`.
- **One copy concern:** the agency-contact line on Screen 04 says "Em caso de dúvida, fale com a {agencyName}" — but the line directly below it ALSO says "Imobiliária Costa & Filhos" as the agency identification. Reading it: "Imobiliária Costa & Filhos. Em caso de dúvida, fale com a Imobiliária Costa & Filhos. Email: …" — the agency name appears three times in eight words. Tighten. See Polish fix #2.
- **Specificity is real.** Amounts like `R$ 2.847,00`, ledger `61.234.567`, durations `4h37m`. No round numbers, no Lorem Ipsum.
- **i18n parity** is contractual (S9 BRIEF, gap-analysis §i18n). Design phase produces both pt-BR and en strings; that needs build-phase verification.

## Implementation quality

The design names exact components, exact files, and exact STYLE.md sections per screen. The component plan distinguishes Reuse / Refactor / New cleanly. Phase boundaries (v1 vs v1.1) are pre-decided.

- **Responsive thoughtfulness:** 360px baseline, 14-char address chunks computed to fit at 0.875rem Mono with 0.02em letter-spacing inside a 280px usable card width — that math appears explicitly in `responsive.md`. The desktop two-column split on Screen 02 (54/46) is justified by the address column needing four wrapped lines without crowding.
- **Loading states designed up front** for every screen, with explicit skeleton stack proportions (60%/50%/40% widths) and no shimmer per motion dial.
- **Print stylesheet for the receipt** is fully specified — chrome stripped, 4px stripe preserved as grey, stellar.expert URL expanded via `a::after`. Production-grade.
- **One implementation risk:** the `border-color` focus strategy depends on every focusable element having a 1px ever-present border by default. shadcn's default Button has no visible border on the `default` variant in many themes; the refactor table notes "Verify `rounded-none`" but doesn't explicitly call out "ensure 1px transparent or matched-color border by default so focus has somewhere to shift." Build-phase risk; flag for `gsp-project-build`.

## Taste signals

- **Intentionality:** Receipt drops the amber CTA so success-green can carry the page. That's a senior call — most designs would have kept a "Compartilhar recibo" or "Imprimir" amber button "for symmetry." Restraint as the differentiator.
- **Visual coherence:** PaymentSummaryHeader as the universal three-layer machine creates an unmistakable rhythm across the flow. Open any of the five screens that use it and the brand reads the same.
- **Confidence in constraints:** No outline on focus, no rotation on spinners, no shimmer on skeletons. Each refusal is brand-true.
- **Craft in details:** 4×14 address chunks, the "≈" symbol on BRL equivalents, the 11-pt print rendering, the `aria-label` on the unbroken address so SR doesn't read it as four lines. These are the details that separate "design" from "designed by someone who cares."
- **Distinctiveness:** Could a reviewer ask "who designed this?" — yes. The combination of Brazilian-light theme + Brutalist 0px corners + Mono evidence rows + amber-as-precious-metal is not a generic SaaS look. It reads as TGA.

## Strategic alignment summary

The design successfully translates a polarized brand brief ("infrastructure precision" + "Imobiliárias warmth") into a tenant-facing flow that neither feels like a trading terminal nor like a consumer fintech. The biggest strategic win is the receipt: institutional restraint that nonetheless feels human because the 4px green stripe lands like ink, not LED.

The biggest strategic risk is mobile first-screen density on Mode A (Screen 02). At 360px, six stacked content blocks on the hero card may feel dense for a user whose mental model is "I just want to scan a thing." A small re-balance (collapsible help moves above the address block; secondary "Copiar endereço" button merges into the address-as-button affordance) would tighten this without changing IA.

## Score totals

- **Brand contract: 24/25** (no constraint violations)
- **Nielsen heuristics: 45/50**
- **Verdict:** Pass. Ship to build. Issues identified are addressable inline; no re-design required.
