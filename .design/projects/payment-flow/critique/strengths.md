# Strengths to Preserve

> Chunk: strengths | Phase: critique | Project: payment-flow | Generated: 2026-05-13

What's working well, and why. Build phase should preserve these; future iterations should not regress them.

## 1. The receipt as institutional restraint

→ `../design/screen-04-receipt.md`

Most fintech receipts celebrate with checkmarks, "Obrigado!" banners, confetti, or full-screen overlays. This receipt declares "Pagamento confirmado" in Geist Bold and lets the 4px `#2E8B5A` top-edge stripe be the entire celebration. The amber CTA — present everywhere else in the flow — is *deliberately absent* so success-green can own the moment.

This is the design's strongest taste signal. It signals to Daniel that TGA is infrastructure, not a consumer app. It signals to Camila that the payment really happened (because the document doesn't have to convince her with emojis). Preserve absolutely.

## 2. PaymentSummaryHeader as the rhythm engine

→ `../design/shared/information-architecture.md` §"Component hierarchy"

One component carries agency + amount + due date across five of seven screens, in exactly three typographic registers (Inter agency, Geist Bold amount, Mono due date). Camila never has to scroll to confirm what she's paying. Lucas (the imobiliária owner) sees his agency name above the amount the first time he QAs the link on his phone. The three-layer hierarchy rule becomes a property of the component, not a per-screen checklist.

This is the single most consistency-multiplying decision in the project. Preserve the component contract; don't let new screens reinvent the summary.

## 3. Three convenience tiers for Mode A — without ranking

→ `../design/screen-02-address-mode.md` §"Purpose"

The brief asks for "real choice" between methods. The design extends this *within* a method: scan QR / tap deep-link / copy address — three execution paths that carry the same SEP-7 payload. Stacked by convenience, but presented as equals. No "recommended" badge, no "fastest" label.

This is brand-true (Ruler archetype communicates through equals, not through a sales pitch) and persona-true (Camila might forward to a relative, Daniel verifies the QR encoding, both succeed via their preferred path). Preserve the equality framing.

## 4. The voice that refuses to celebrate

→ `../research/recommendations.md` C2, content-strategy.md (referenced)

Forbidden vocabulary: `blockchain`, `onchain`, `smart contract`, `token`, `wallet` (use `carteira`), `protocolo`, `liquidação`, exclamation marks, emojis. The receipt deliberately drops "Obrigado pelo pagamento!" The error boundary refuses "Ops!" The expired screen refuses "😢".

The voice gives the brand its calm authority. Preserve the forbidden list as part of the build phase i18n review.

## 5. Designed empty/loading/error/print states for every screen

→ all design chunks, §"States" per screen

The success criterion S10 ("Empty / expired / failed states are designed up front") is honored without exception. Every screen specifies loading skeleton proportions (60%/50%/40% widths), error inline-degradation behavior, and print stylesheet behavior where relevant. The receipt has a full `@media print` spec including `page-break-inside: avoid`.

This eliminates the build-phase pattern where empty states arrive as afterthoughts. Preserve the discipline; don't let v1.1 features ship without their corresponding state specs.

## 6. Accessibility worked into the design, not retrofitted

→ all design chunks, §"Accessibility" per screen

The QR's `<title>` + `<desc>` ARIA pattern. The `<code>` element with `aria-label` carrying the unbroken Stellar address (SR reads it once, not four times). Focus management explicitly documented per-screen, with the `error.tsx` heading-focus exception called out as the documented deviation. Touch targets ≥48px exceed WCAG 2.5.8 and the 44×44 mobile recommendation. The `role="alert"` on error inline lines vs `role="status"` on the poller — distinguished correctly.

The author understands the spec. Preserve the accessibility-as-design-input discipline.

## 7. Phase boundaries baked into the IA

→ `../design/shared/component-plan.md` §"Phase boundaries", screen-03 §"v1 → v1.1 transition checklist"

The wallet-mode (Mode B) screen ships as a scaffolded file structure in v1 (route exists, component exists, i18n strings exist) but the env flag gates the actual rendering. Flipping the flag in v1.1 requires no design revisit. The mode-toggle tabs on Screen 01 ship the same way — invisible until both modes are configured.

This is forward-thinking IA — the design phase decides what v1.1 looks like so the team isn't surprised. Preserve the v1/v1.1 separation in the build phase commit-by-commit; don't accidentally enable v1.1 paths.

## 8. The 4×14 address-chunking decision

→ `../design/screen-02-address-mode.md` §"Layout (mobile)" + `../design/shared/responsive.md`

A 56-character Stellar strkey is hard to render on 360px. The author computes: 14 chars × 0.875rem JetBrains Mono with 0.02em letter-spacing = 176px, fits inside a 280px usable card width with breathing room. Four lines × 14 chars hits 56 cleanly. The `aria-label` carries the unbroken string so SR doesn't read four chunks.

Math + craft + accessibility in one decision. Preserve the chunking; don't let build re-flow at runtime.

## 9. Effects vocabulary discipline

→ `../design/shared/micro-interactions.md` §"Master table"

18 documented state changes. Zero use of `transform: scale|translate|rotate` (except skip-link reveal, justified). The Mode B "spinner" replaced by three opacity-cycled amber squares. No shimmer on skeletons. The transform exception is explicitly called out and justified.

This is a designer who read STYLE.md as a contract. Preserve the table as the build-phase reference; don't let shadcn defaults sneak transforms back in.

## 10. Idempotent route logic

→ `../design/shared/navigation.md` §"Back behavior", screen-04 §"Interactions" row #7

`router.replace` (not `push`) on the auto-redirect from /endereco → /recibo prevents back-button loops. Visiting `/recibo` on a non-paid payment redirects back to `/pagar/[publicId]`. Visiting `/encerrado` on a non-terminal payment redirects forward. The flow has no dead ends.

Preserve the routing semantics; build phase should test all idempotency invariants.
