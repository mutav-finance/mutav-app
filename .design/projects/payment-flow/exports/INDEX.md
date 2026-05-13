# GSP Design Exports

> Load this file first, then load only the chunks needed for your task.

## Usage

This file is the entry point for coding agents consuming GSP design output.

1. Read this file to find chunk paths for your task
2. Load only the chunks relevant to your current screen or component
3. Each chunk is self-contained — follow `## Related` links for cross-references

## Quick Reference

- Building a screen? → Design table → load screen chunk + referenced components
- Need a component spec? → Components table (in brand system)
- Need color/type/spacing? → Foundations table (in brand system)
- Need project scope? → Brief table
- Need UX patterns or reference specs? → Research table

## Design System (Brand-Level)

<!-- BEGIN:system -->
| Section | Chunk | Lines |
|---------|-------|-------|
| Brand patterns | [.design/branding/tga/patterns/STYLE.md](../../../branding/tga/patterns/STYLE.md) | — |
| Brand preset | [.design/branding/tga/patterns/tga.yml](../../../branding/tga/patterns/tga.yml) | — |
<!-- END:system -->

## Project Brief

<!-- BEGIN:brief -->
| Section | File |
|---------|------|
| Scope | [scope.md](../brief/scope.md) |
| Target Adaptations | [target-adaptations.md](../brief/target-adaptations.md) |
| Gap Analysis | [gap-analysis.md](../brief/gap-analysis.md) |
| File References | [file-references.md](../brief/file-references.md) |
<!-- END:brief -->

## Project Research

<!-- BEGIN:research -->
| Section | File |
|---------|------|
| UX Patterns | [ux-patterns.md](../research/ux-patterns.md) |
| Competitor UX | [competitor-ux.md](../research/competitor-ux.md) |
| Technical Research | [technical-research.md](../research/technical-research.md) |
| Accessibility Patterns | [accessibility-patterns.md](../research/accessibility-patterns.md) |
| Content Strategy | [content-strategy.md](../research/content-strategy.md) |
| Reference Specs | [reference-specs.md](../research/reference-specs.md) |
| Recommendations | [recommendations.md](../research/recommendations.md) |
| Stellar Modes (addendum) | [stellar-modes.md](../research/stellar-modes.md) |
<!-- END:research -->

## Design

<!-- BEGIN:design -->
### Screens

| # | Screen | File | Components Used |
|---|--------|------|-----------------|
| 01 | Landing / Mode Resolver | [../design/screen-01-landing.md](../design/screen-01-landing.md) | `PublicShell`, `PaymentSummaryHeader`, `ModeResolver`, shadcn `Tabs` (v1.1+), `PublicFooterMeta` |
| 02 | Address Mode (Stellar, v1) | [../design/screen-02-address-mode.md](../design/screen-02-address-mode.md) | `PaymentAddressPanel`, `PaymentAddressQrCode`, `AssetAmount`, `CopyableAddress`, `CopyableValue`, `HorizonPaymentPoller`, shadcn `Card`/`Button`/`Separator`/`Collapsible`/`Sonner` |
| 03 | Wallet Mode (Soroban, v1.1) | [../design/screen-03-wallet-mode.md](../design/screen-03-wallet-mode.md) | `WalletConnectPanel`, `WalletConnectClient`, `AssetAmount`, `HorizonPaymentPoller`, shadcn `Card`/`Button`/`Collapsible` |
| 04 | Receipt | [../design/screen-04-receipt.md](../design/screen-04-receipt.md) | `PaymentReceiptCard`, `PaymentStateTag`, `AssetAmount`, `CopyableValue`, `StellarExplorerLink`, shadcn `Card` (`data-stripe="paid"`)/`Separator` |
| 05 | Expired / Canceled | [../design/screen-05-expired.md](../design/screen-05-expired.md) | `PaymentExpiredCard`, `PaymentStateTag` (overdue/canceled/notFound), shadcn `Card`/`Button` |
| 06 | Error Boundary | [../design/screen-06-error.md](../design/screen-06-error.md) | `PaymentErrorBoundary`, `PaymentStateTag` (error), shadcn `Card`/`Button` |
| 07 | Not Found | [../design/screen-07-not-found.md](../design/screen-07-not-found.md) | `PaymentStateTag` (notFound), shadcn `Card` |

### Shared

| Section | File |
|---------|------|
| Personas | [../design/shared/personas.md](../design/shared/personas.md) |
| Information Architecture | [../design/shared/information-architecture.md](../design/shared/information-architecture.md) |
| Navigation | [../design/shared/navigation.md](../design/shared/navigation.md) |
| Micro-Interactions | [../design/shared/micro-interactions.md](../design/shared/micro-interactions.md) |
| Responsive | [../design/shared/responsive.md](../design/shared/responsive.md) |
| Component Plan | [../design/shared/component-plan.md](../design/shared/component-plan.md) |
| Design INDEX | [../design/INDEX.md](../design/INDEX.md) |
<!-- END:design -->

## Design Critique

<!-- BEGIN:critique -->
| Section | File |
|---------|------|
| Critique | [critique.md](../critique/critique.md) |
| Prioritized Fixes | [prioritized-fixes.md](../critique/prioritized-fixes.md) |
| Alternative Directions | [alternative-directions.md](../critique/alternative-directions.md) |
| Strengths | [strengths.md](../critique/strengths.md) |
| Accessibility Audit | [accessibility-audit.md](../critique/accessibility-audit.md) |
| Accessibility Fixes | [accessibility-fixes.md](../critique/accessibility-fixes.md) |
<!-- END:critique -->

## Build

<!-- BEGIN:build -->
| Section | File |
|---------|------|
| _(populated by /gsp-project-build)_ | |
<!-- END:build -->

## QA Review

<!-- BEGIN:review -->
| Section | File |
|---------|------|
| _(populated by /gsp-project-review)_ | |
<!-- END:review -->
