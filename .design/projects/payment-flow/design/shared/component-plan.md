# Component Plan

> Chunk: component-plan | Phase: design | Project: payment-flow | Generated: 2026-05-13

Target stack: `Next.js 16 (App Router) + React 19 + Tailwind 4 + shadcn/ui + next-intl + Convex`. Existing component inventory scanned from `src/components/`.

## Reuse (as-is)

| Component | Source | Screens used |
|---|---|---|
| `Card`, `CardContent` | `src/components/ui/card.tsx` (shadcn) | 02, 03, 04, 05, 06 |
| `Button` (`default` amber + `outline`) | `src/components/ui/button.tsx` (shadcn) | 02, 03, 04, 05, 06 |
| `Skeleton` | `src/components/ui/skeleton.tsx` (shadcn, shimmer disabled globally) | 02, 03 — loading states |
| `Sonner` toaster | `src/components/ui/sonner.tsx` (shadcn) | 02, 04 — copy confirmations |
| `Mono` | `src/components/ui/mono.tsx` (existing brand primitive) | 02, 03, 04, 05 — every numeric value |
| `PaymentStateTag` | `src/components/payments/payment-state-tag.tsx` (existing) | 04, 05 — square+label badge per STYLE.md §3.5 |
| `Separator` | `src/components/ui/separator.tsx` (shadcn) | 02, 04 — horizontal rules inside cards (1px solid, 0px radius) |
| `Tabs`, `TabsList`, `TabsTrigger`, `TabsContent` | `src/components/ui/tabs.tsx` (shadcn) | 01 — mode toggle (rendered only when both modes enabled — v1.1+) |
| `PageShell` | `src/components/page/page-shell.tsx` | all screens (via `PublicShell`) |
| `PageContent` (variant `narrow`) | `src/components/page/page-content.tsx` | all screens |
| `Link`, `useRouter`, `redirect` | `@/i18n/navigation` | navigation primitives — never `next/navigation` directly |

## Refactor (needs changes)

| Component | Source | Changes | Why |
|---|---|---|---|
| `Button` (shadcn) | `ui/button.tsx` | Verify `rounded-none` on all variants; verify amber `default` variant maps to `--color-accent` fill + `#1A1A1A` text per STYLE.md §3.2 (Imobiliárias column); `size="lg"` is 48px tall | Brand contract requires zero exceptions; existing project may have inherited shadcn shadows that need stripping |
| `Skeleton` | `ui/skeleton.tsx` | Disable shimmer animation globally (`prefers-reduced-motion` always-applied for this flow); fill = `--color-surface-2` | STYLE.md motion dial = 2; no decorative shimmer |
| `Sonner` | `ui/sonner.tsx` | Verify `role="status"` + `aria-live="polite"` propagate to the toast wrapper; disable slide-in transform (opacity-only fade per micro-interactions table) | STYLE.md no-transform rule |
| `Card` | `ui/card.tsx` | Add top-stripe variant — `<Card data-stripe="paid">` renders a 4px `#2E8B5A` `border-top` (Screen 04 only); no shadow under any variant | Receipt brand pattern per STYLE.md §3.1 + recommendations.md A5 |

## New (shared — promotable beyond payments domain)

| Component | Purpose | File | Screens |
|---|---|---|---|
| `PublicShell` | Public route group shell. Top bar with TGA wordmark, `data-front="imobiliarias"` attribute, `<ThemeProvider forcedTheme="light">` wrapper, skip-link target, optional `PublicFooterMeta` slot. Wraps `PageShell` underneath. | `src/components/public/public-shell.tsx` | all `(public)` screens |
| `PublicFooterMeta` | Footer band with agency contact line + locale toggle. Lives below the main card on every public screen. | `src/components/public/public-footer-meta.tsx` | all |
| `LocaleSwitch` | Inline two-anchor pt-BR / en switcher. Quiet `--color-text-3`, no flags, no select. | `src/components/public/locale-switch.tsx` | reused in `PublicFooterMeta` |
| `CopyableValue` | Wrapper around any `Mono` value with a 44×44 hit-area copy button. Phosphor `Copy` icon → `Check` swap for 1.6s, fires Sonner toast. Synchronous clipboard write inside `onClick` (iOS Safari requirement, per accessibility-patterns.md). | `src/components/payments/copyable-value.tsx` | 02 (address, asset amount), 04 (txHash) |

## New (local — payment-flow specific)

| Component | Purpose | File | Screens |
|---|---|---|---|
| `PaymentSummaryHeader` | Three-layer top block: agency name (Inter) · amount (Geist Bold composite with `<Mono>` for digits) · due-date (Mono) or paidAt on receipt. Stripped of `<Card>` chrome — sits directly on `--color-canvas`. | `src/components/payments/flow/payment-summary-header.tsx` | 01, 02, 03, 04, 05 |
| `ModeResolver` | RSC. Reads payment + agency config, decides which sub-route is the truth. Issues `redirect()` for paid/expired/canceled; renders mode toggle only if both modes are flagged on (v1.1+); otherwise renders nothing — `page.tsx` redirects directly. | `src/components/payments/flow/mode-resolver.tsx` | 01 |
| `PaymentAddressPanel` | Mode A hero card. Contains `PaymentAddressQrCode`, `AssetAmount`, `CopyableAddress`, primary "Abrir em carteira" CTA (SEP-7 `<a>`), and the `HorizonPaymentPoller` live row. | `src/components/payments/flow/payment-address-panel.tsx` | 02 |
| `PaymentAddressQrCode` | RSC. Renders SEP-7 SVG QR (240×240 / 256×256) via `qrcode` library. SVG carries `<title>` + `<desc>` for SR. 1px `#D9D7D2` border, no radius, no quiet-zone art. | `src/components/payments/flow/payment-address-qr-code.tsx` | 02 |
| `CopyableAddress` | Specialized `CopyableValue` rendering a 56-char Stellar strkey as 4 lines × 14 chars (the 4th line ends in `==` checksum). Copy button writes the unbroken string. | `src/components/payments/flow/copyable-address.tsx` | 02 |
| `AssetAmount` | Two-line `Mono` block: `1234.5678 XLM` then `≈ R$ 2.847,00`. Asset symbol part of the same Mono run. | `src/components/payments/flow/asset-amount.tsx` | 02 (panel), 04 (receipt) |
| `HorizonPaymentPoller` | Client island. `useQuery(api.payments.useCases.getPublicByPublicId)` reactive subscription; on `state.kind === "paid"`, `router.replace("/recibo")`. Visual: 6×6 amber square (the live pulse, animation #9) + Mono "Aguardando pagamento na rede" line. | `src/components/payments/flow/horizon-payment-poller.tsx` | 02, 03 |
| `WalletConnectPanel` | Mode B hero card. "Conectar carteira" CTA cycles `idle → signing → submitting → confirming → done` states via internal `useState`. Wraps `WalletConnectClient`. Renders only when `STELLAR_CONTRACT_MODE` env flag is on (v1.1). | `src/components/payments/flow/wallet-connect-panel.tsx` | 03 |
| `WalletConnectClient` | `"use client"` + dynamic-import island. Wraps `@stellar/freighter-api` calls. Isolated to one file so the auditable security surface is minimal. Mounted only when its parent is rendered (which requires the env flag). | `src/components/payments/flow/wallet-connect-client.tsx` | 03 |
| `PaymentReceiptCard` | Paid-state card. 4px `#2E8B5A` top stripe (`data-stripe="paid"`). Header: `PaymentStateTag state="paid"` + "Pagamento confirmado" (Geist Bold). Body: `AssetAmount` + paidAt + ledger # + `StellarExplorerLink`. Footer: agency contact card. | `src/components/payments/flow/payment-receipt-card.tsx` | 04 |
| `StellarExplorerLink` | `<a>` to `https://stellar.expert/explorer/{network}/tx/{txHash}` with Phosphor `ArrowSquareOut` light icon. `target="_blank"`, `rel="noopener noreferrer"`. Color `--color-text` (never amber). | `src/components/payments/flow/stellar-explorer-link.tsx` | 04 |
| `PaymentExpiredCard` | Single layout for `overdue` + `canceled` + `notFound`. `PaymentStateTag` (square+label) + Geist Bold title + Inter body + primary "Fale com {agencyName}" CTA. | `src/components/payments/flow/payment-expired-card.tsx` | 05, 06, 07 |
| `PaymentErrorBoundary` | `error.tsx` for `/pagar/[publicId]`. Catches Convex query failures. Renders the same shape as `PaymentExpiredCard` with localized `errors.LOAD_FAILED` copy + retry. | `src/app/[locale]/(public)/pagar/[publicId]/error.tsx` | 06 |

## Phase boundaries

- **v1 ships:** all "Reuse", "Refactor", and "New" rows EXCEPT `WalletConnectPanel` / `WalletConnectClient` (gated behind `STELLAR_CONTRACT_MODE`). Files exist as empty scaffolds with TODO markers and i18n strings populated.
- **v1.1 ships:** `WalletConnectPanel` body + `WalletConnectClient` Freighter wiring + the Soroban contract address env wiring. No design changes; the flag flip just exposes the route.

## Convex-side companions (not components, but coupled)

| Module | Purpose |
|---|---|
| `convex/payments/useCases.ts :: getPublicByPublicId` | Public query (no `ctx.auth`); returns `shapePublicPayment` projection of agency + payment fields safe to expose |
| `convex/payments/useCases.ts :: shapePublicPayment` | Projection function — strips internal fields, exposes only what the public flow needs |
| `convex/payments/actions.ts :: checkMutavTreasuryPayments` | Node action; cron-driven Horizon poller; idempotent `markPaidByTx` mutation per match |
| `convex/payments/domain.ts` | Add `muxedId: v.string()` field + `by_muxedId` and `by_publicId` indexes; new `PAYMENT_ERROR_CODE = { LOAD_FAILED, NOT_FOUND, ... }` value object |
| `convex/lib/env.ts` | `getMutavSourceAccount()`, `getStellarNetwork()`, `getStellarHorizonUrl()` lazy getters |

## i18n keys (`messages/{locale}.json`)

New namespace `paymentFlow.*`:

```
paymentFlow.summary.{agency,amount,due,paidAt,contractRef}
paymentFlow.address.{title,destLabel,assetAmount,brlEquiv,openWallet,copyAddress,waiting,help}
paymentFlow.wallet.{title,connect,signing,submitting,confirming,done,reject,help}
paymentFlow.receipt.{title,confirmedAt,txHash,ledger,explorerLink,agencyContact}
paymentFlow.expired.{title,bodyOverdue,bodyCanceled,contactAgency}
paymentFlow.error.{title,body,retry,contactAgency}
paymentFlow.notFound.{title,body,contactAgency}
paymentFlow.toasts.{copied,copyFailed,networkError}
paymentFlow.shell.{skipLink,brandMark,localeSwitch}
```

Parity required between `pt-BR.json` and `en.json` — design phase produces both. Critique phase audits.
