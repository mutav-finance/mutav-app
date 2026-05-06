# Critique — Contract Details

> Phase: critique · Project: contract-details · Brand: TGA · Front: Imobiliárias · Date: 2026-05-06
> Mode: retroactive — page is shipped on `feat/contract-details-page`; this critique re-grounds against the current code.

---

## 1. Strategy alignment

The brief asks the page to answer four questions without scrolling more than a screen and a half: *what is this contract, what does it cover, what documents exist, who is the tenant*. The implementation honours all four — section order is `Summary → RentalData → Documents → History → Tenant`, and each card has a single job. The audit log sits last, collapsed-but-default-open, which respects "evidence first, narrative last" without hiding it.

The persona (Lucas, gestor de imobiliária, density-4) is served by `max-w-4xl` content column, `gap-4 md:gap-6` between cards, and 24px card padding. This is **not** the dense Investidor terminal, and it shouldn't be — the brief is explicit that Imobiliárias is "structured warmth," not compression. The page reads correctly for that audience.

What the page does **not** yet do is differentiate by front. `:root` resolves to Imobiliárias tokens, `.dark` resolves to Investidor tokens, and the route is reachable in both modes. STYLE.md treats the fronts as different intensity profiles (variance, density, typography ceiling), not as a single design that gets dark-mode-swapped. This is acceptable as MVP simplification, but it dilutes the brand's three-fronts thesis. Flagged in fixes.

**Strategy score: solid pass.** The page does the job the brief asks of it.

---

## 2. Brand contract (X/25)

| Dimension | Score | Notes |
|---|---|---|
| Constraint adherence | 4/5 | All hard `never`s respected in source: no raw color scales, no rounded corners, no shadows, no glow, no `#22C55E`, no amber on icons. The global `* { border-radius: 0 !important }` belt-and-braces still ships, but every shadcn primitive used here also reads correctly without it (verified by grepping `rounded-*` in the contract components — zero matches). One amber-icon edge case: `text-success` on the tenant footer check is not amber, so OK. The 1-point deduction is for the outline `Cancel proposal` button in summary having no Imobiliárias amber treatment per §3.3 (Imobiliárias secondary spec is `border #C47E10 / text #C47E10`); current shadcn outline uses `border-border / text-foreground`, which reads as Investidor secondary. |
| Pattern fidelity | 4/5 | StatusTag matches §3.5 spec exactly (6×6 square, JetBrains Mono 11px, no fill, label inherits foreground). Card surfaces match §3.1 (white, 1px border, 24px padding, no shadow). Promo banner uses `--accent-dim` (`#FFF0D4`) — the explicit "good news container" surface from STYLE.md §3.1 inadimplencia/pagamento row. Deduction: §3.5 specifies Imobiliárias card-value is "JetBrains Mono Medium 16px tabular-nums" — the contract id in the summary is rendered Geist Bold 28px instead. Defensible (it's the page's evidence anchor) but a deviation from the table. |
| Effects vocabulary | 5/5 | No transforms, no shadows, no glass. Buttons, hovers, and the collapsible follow §5: 150ms ease-out color/bg/border/opacity only. The pulse animation isn't used on this route (correct — it belongs on live status dots elsewhere). `prefers-reduced-motion` honored globally. |
| Intensity calibration | 3/5 | Variance 3 (predictable), motion 2 (none on this route except focus and Radix collapsible), density target 4 for Imobiliárias. The page reads as density 4 — appropriate. But the **typographic intensity is ambiguous**: hero h1 is `text-3xl` (28px), and the contract id repeats `text-3xl` Geist Bold three rows below. Bold Bet 4 mandates exactly one Geist Bold declaration per screen; the page has two (hero + contract id) plus a third (promo banner title at `text-xl` Geist Bold). The repeated declaration weakens the singular anchor. Deduction also reflects the front-collapsing-into-light/dark issue called out in §1. |
| Bold bet presence | 4/5 | (1) Zero radius — yes, source-clean. (2) Amber as precious metal — yes, ~0.4% of the route's pixels at 1280×900 (verified math in `design/color-tokens.md`). (3) Tabular numerals — `<Mono>` component shipped, every numeric value pipes through it. (4) Three-layer hierarchy — Geist (hero, contract id, promo title), Inter (body, labels), JetBrains Mono (every number, every datetime, every uppercase mono label) — present. (5) Surface stacking without shadows — yes; depth comes from `bg-card` over `bg-background`, `bg-secondary` for icon containers, no `box-shadow` anywhere. Deduction: bet 4's "exactly one Geist Bold declaration" is technically violated (see intensity row). Other four bets: clean. |

**Brand contract: 20/25 — Pass.**

No dimension scores 1, so no constraint-violation auto-fail. The two recurring deductions point to one root issue: declaration multiplicity. Hero, contract id, and promo title all read as Geist Bold declarations of similar weight; the page would gain rigor if exactly one of those carried the page's argument and the other two stepped down (mono for the contract id, Inter Medium for the promo title).

---

## 3. Usability — Nielsen heuristics (X/50)

| # | Heuristic | Score | Specific reasoning |
|---|---|---|---|
| 1 | Visibility of system status | 4 | StatusTag at hero, summary, documents, and tenant cards. Status is communicated as text + 6×6 colored square — never color alone. Loading state absent (acceptable today: data is sync from fixtures; flagged in `states.md`). The history `aria-expanded` toggle and chevron synchronize correctly. |
| 2 | System ↔ real-world match | 5 | Every label is in the user's domain language: "Inadimplência," "Fiança disponível," "Próxima Renovação estimada," "Termo Aprovado," "Multiplicador locatício." pt-BR is canonical, EN is parity. No blockchain jargon leaks into Imobiliárias copy (per BRIEF constraint). The hero title interpolates the localized status: "Contrato Ativo" / "Contrato Pendente." |
| 3 | User control + freedom | 3 | Breadcrumb `Dashboard › #<id>` provides one escape route. There is no explicit back link beyond browser back. The summary card's three header actions are all disabled or non-destructive — no "undo last edit" surface yet because no editing exists. The collapsible history can be re-collapsed. The disabled `Cancel proposal` button cannot be canceled-out-of (it is permanently disabled with no explanation), which limits the freedom-from-mistakes story in a different direction (see #5, #9). |
| 4 | Consistency + standards | 4 | Every CardHeader uses the same Mono 12px tracking-0.06em uppercase title. Every numeric value pipes through `<Mono>`. Empty values are uniformly `—` (em-dash, not hyphen, not "N/A"). FieldRow grid behaviour is identical across rental, property, optional, and tenant cards. Deduction: shadcn `CardTitle` defaults to `<div>` not `<h2>`/`<h3>`, so the page has only one true heading. Five "card title-shaped" labels are visually consistent but semantically not navigable as headings. Inconsistency between visual and structural hierarchy. |
| 5 | Error prevention | 3 | The disabled state on `Cancel proposal`, on the rental-data overflow menu, and on every document upload button prevents the user from triggering broken/unbuilt features. Good. But there is no `aria-describedby` linking each disabled control to a "why is this off?" message. Lucas does not learn whether the action is unavailable for **this contract** (state-dependent) or **everywhere** (not yet built) — and the answer matters. |
| 6 | Recognition over recall | 4 | All values are presented inline: status, date, amounts, multipliers. Field labels are explicit; nothing is encoded in icons-only. `<dl>`/`<dt>`/`<dd>` semantics throughout. The property kind is rendered as both an icon and a lowercase mono label below the icon — recognition reinforced. The footnote "* {guaranteeTooltip}" relies on the user noticing an asterisk; not strict recall, but weak. |
| 7 | Flexibility + efficiency | 3 | No keyboard shortcuts (acceptable for a read-mostly page). No power-user affordances yet (export, print, copy id). The page's only progressive feature is the collapsible history. Score 3, not lower, because nothing here is *needed* yet — but every contract page eventually needs "copy contract id" and "export PDF" surfaces. |
| 8 | Aesthetic + minimalist | 5 | Zero decoration. Three typefaces used to argument, not embellishment. No gradients, glass, or shadows. Amber budget verified under 1% of route pixels. Spacing on the 8px grid throughout. The `<Mono>` component is the visual proof that "every number is machine-printed" — exactly the Caregiver-meets-Ruler argument STYLE.md requires. |
| 9 | Error recovery | 3 | No `error.tsx` boundary in the `(app)/contracts/[id]` segment — a thrown error during render falls through to Next's default error UI, which is unbranded. `notFound()` redirects to the (default) Next 404 page. Disabled buttons with no explanatory tooltip prevent recovery from "I don't understand why I can't do this." |
| 10 | Help + documentation | 3 | The `* {guaranteeTooltip}` footnote is the only inline explainer; it's plain text, not a real `<button>`-driven popover, and the `*` glyph is a screen-reader-noise ornament (see accessibility-audit). No global help link from this route. The breadcrumb labels are clear. The asterisk pattern is the brand's biggest copy-precision wobble — STYLE.md voice is "specific over general," and "* this number is qualified" is exactly the kind of decorative ASCII the brand opposes. |

**Total: 37/50 — Conditional Pass.**

The page is shippable. The recurring weaknesses cluster around three things: disabled-state explanation, error/loading surfaces, and the asterisk footnote pattern. None are catastrophic; all are addressable in a follow-up commit.

---

## 4. Accessibility (cross-reference)

Audit summary lives in [`accessibility-audit.md`](./accessibility-audit.md); fixes in [`accessibility-fixes.md`](./accessibility-fixes.md).

Headlines: contrast pairs all pass AA (verified math in `design/color-tokens.md`); skip-link styled but not rendered in `(app)/layout.tsx`; `CardTitle` defaults to `<div>` so heading hierarchy is shallow; disabled controls lack `aria-describedby`; touch targets at `size="sm"` are 28×28 — passes SC 2.5.8 AA (24×24) but below the 44×44 mobile recommendation.

---

## 5. Content quality

**Real copy throughout.** No Lorem Ipsum, no "John Doe," no "Acme Corp." Field labels are domain-precise pt-BR. The status vocabulary (`ativo`, `pendente`, `encerrado`, `cancelado`, `enviado`, `aprovado`, `reprovado`) maps to the protocol's actual contract lifecycle.

**Voice:** Authoritative-calm matches the brand. "Termo Aprovado · 2025-09-12 14:23" reads as the Caregiver's reassurance plus the Ruler's evidence. The promo banner ("Quita Loft — Evite inadimplências: ofereça ao inquilino a opção de pagar o aluguel no cartão e receba o valor à vista") is specific and mechanism-driven, not aspirational marketing-speak — STYLE.md voice approved.

**Specificity:** Strong. No "click here," no "learn more" without context (the promo CTA "Saber mais" is the one exception — acceptable for a marketing prompt, not for primary actions).

**Microcopy:**
- Empty history: "Sem registros." — clean, matches brand.
- Empty FieldRow: "—" em-dash — correct.
- Disabled buttons: no helper copy. Gap.
- Asterisk footnote: "* {guaranteeTooltip}" — see fix #1.

---

## 6. Implementation quality

**Layout:** `max-w-4xl` (896px) centered column. Reasonable for a detail view. Cards stack at `gap-4 md:gap-6`. Internal padding is `px-6 py-3` to `py-6`. No purposeless cards — every section earns its border. Documents card uses a 3-column grid for the three fixed slots; collapses to 1 column on small screens (`sm:grid-cols-3`). Rental data card uses `lg:grid-cols-[auto_1fr]` for the icon rail + `<dl>` split — appropriate for the content shape.

**Surfaces:** Three depth layers used intentionally — canvas (`#F7F6F3`), card (`#FFFFFF`), surface-2 (`#EEEDEA` for icon containers and FieldGroupHeader bars). No shadow leakage from shadcn defaults — verified.

**Motion:** Only the Radix collapsible animates (height/opacity, default Radix easing). No transforms. Focus ring is `outline: 1px solid var(--accent)` with 2px offset. `prefers-reduced-motion` is acknowledged globally for the live-pulse class (which isn't used on this route).

**Components:** Mostly customized. `Card`, `Button`, `Breadcrumb`, `Collapsible`, `DropdownMenu` are shadcn radix-nova base. `StatusTag`, `Mono`, `FieldRow`, `FieldGroupHeader` are page-local TGA primitives. The shadcn `Button` `size="sm"` ships with `rounded-[min(var(--radius-md),12px)]`; this is neutralized at runtime by the `* { border-radius: 0 !important }` global rule in `globals.css:174`. Source still emits the rounded class — defensible (less invasive than forking shadcn) but worth a note in the brand-apply pass.

**Interaction:** Every button has a hover state via shadcn defaults (color/bg transition, 150ms ease-out — matches §5). Disabled states use shadcn's `disabled:opacity-50 disabled:cursor-not-allowed`. No skeleton states. No optimistic UI (no mutations to be optimistic about yet).

**Responsive:** FieldRow stacks at base, two-column at `sm:`. Documents grid stacks at base, three-column at `sm:`. Rental data icon rail collapses at `lg:`. The page reads at 320px without horizontal scroll (verified by reading classes — `text-2xs` to `text-3xl`, `gap-3` to `gap-6`, no fixed widths). Hero `text-3xl` does not fluid-clamp — STYLE.md typography table specifies `text-3xl` as 24→28px fluid for Imobiliárias, but `globals.css:94` ships static 28px. Minor: STYLE.md provides clamp values; this route ignores them.

---

## 7. Taste signals

The page sits at **level 4 — Refined**. Not yet level 5 — distinctive — for one reason: a stranger looking at this page would recognize "shadcn dashboard with custom tokens." A stranger looking at the same page in two months, after the proposed fixes, should recognize "TGA." The gap is mostly about the asterisk footnote, the disabled-button silence, and the doubled Geist declaration. None are decorative — all are precision-of-voice.

**What earns the 4:**
- The `<Mono>` component is invisible-but-everywhere. The page's tabular alignment of `R$2.500,00`, `R$845,00`, `R$3.345,00` in the rental card is a brand argument made structurally, not stylistically.
- The 6×6 square + Mono uppercase label pattern is consistent across status, document, and approval contexts — same shape, different tone.
- Field group headers are a `bg-secondary` band (`#EEEDEA`) that creates lateral structure inside the rental data `<dl>` without inventing a new component.
- 0px radius is invisible until you compare it to a generic shadcn dashboard. Then it's the page's posture.

**What blocks the 5:**
- No distinctive asymmetry — the page is a centered column of stacked cards. STYLE.md doesn't forbid asymmetry; it just doesn't appear here.
- The promo banner is the one piece of "marketing in the page," and it competes with the hero declaration tonally (cream surface + Geist Bold 20px title + amber CTA — three brand events stacked under the hero).
- No live-feel cues. The page is read-only and looks read-only — fine for now, but a future "live status" pulse on the contract status square would push the page toward instrumentation.

---

## Verdict

**Conditional Pass. Ship-ready, with notes.**

- Nielsen 37/50 (≥30 floor, <40 ceiling)
- Brand contract 20/25 (≥15 floor, <22 ceiling)
- No dimension at 1
- No critical accessibility blockers (verified separately)

Recommended path: address the Critical and Important fixes (see [`prioritized-fixes.md`](./prioritized-fixes.md)) before merging to main. The Polish list can ship incrementally.

## Cross-references

- [`prioritized-fixes.md`](./prioritized-fixes.md)
- [`alternative-directions.md`](./alternative-directions.md)
- [`strengths.md`](./strengths.md)
- [`accessibility-audit.md`](./accessibility-audit.md)
- [`accessibility-fixes.md`](./accessibility-fixes.md)
- Source: `src/components/contracts/contract-details-page.tsx` and siblings
- Brand: `.design/branding/tga/patterns/STYLE.md`
- Prior audit: `docs/UI-REVIEW.md`
