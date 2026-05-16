# Checkout — Unified Payment Flow

> Generated: 2026-05-16 via gsp-project-design · Supersedes the drawer
> built on PR #65 · Targets the v1.2 redesign of `pagar/[publicId]/...`

Replaces the bottom-drawer ("Pagar com Stellar" / "Pagar com PIX" buttons
on the payment-details `PaymentMethodCard`) with a dedicated full-page
checkout under `/pagar/[publicId]/...`. Same route serves both
agency-authed viewers (with dashboard chrome) and renter-public viewers
(with `PublicHeader` / `PublicFooter`).

## 1. Architecture

### Routes (App Router, `(public)` group)

```
src/app/[locale]/(public)/pagar/[publicId]/
├── layout.tsx              # PublicShell when no session, AppShell when authed
├── page.tsx                # Method picker (Step 1)
├── stellar/page.tsx        # Stellar pay (Step 2a)
├── pix/page.tsx            # PIX pay (Step 2b)
└── pago/page.tsx           # Confirmation (Step 3)
```

`layout.tsx` reads `ctx.auth.getUserIdentity()` server-side; if the
viewer is a member of `payment.agencyId`, render the dashboard shell,
else `PublicShell`. The page chunks are identical in both — only the
chrome swaps.

### State machine (server-driven, derived from Convex)

```
unpaid + method=null      → /pagar/[id]          (picker)
unpaid + method=stellar   → /pagar/[id]/stellar  (QR + SEP-7)
unpaid + method=pix       → /pagar/[id]/pix      (Pix QR + copy)
paid                      → /pagar/[id]/pago     (receipt)
expired | canceled        → /pagar/[id]/pago     (state variant)
```

Method selection invokes `setPaymentMethod`. The layout reads
`payment.method` / `state` via `usePreloadedQuery` and `redirect()`s to
the canonical step — URL is always truthful, browser-back-correct,
refreshable.

## 2. Screens (mobile-first, 360 px)

### Step 1 — Method picker (`/pagar/[id]`)

```
┌─────────────────────────────────┐
│ MUTAV          MAGIC-LINK · ••42│
├─────────────────────────────────┤
│  R$ 1.247,50                    │
│  ──────────                     │
│  IMOBILIÁRIA ALVES · vence 23/05│
│  ► Ver detalhes (3 contratos)   │
├─────────────────────────────────┤
│  COMO VOCÊ QUER PAGAR?          │
│ ┌─────────────────────────────┐ │
│ │ ▣ PIX                       │ │
│ │ Direto da sua conta · 1 min │ │
│ │ Instantâneo                 │ │
│ └─────────────────────────────┘ │
│ ┌─────────────────────────────┐ │
│ │ ▣ CRIPTO (STELLAR)          │ │
│ │ XLM ou USDC · QR ou link    │ │
│ │ ~10 segundos                │ │
│ └─────────────────────────────┘ │
│ ⌜ Pagamentos processados pela   │
│   Etherfuse (PIX, CVM)          │
│   e Stellar (cripto)            │
├─────────────────────────────────┤
│ 🔒 SSL · powered by Stellar     │
└─────────────────────────────────┘
```

Two equal-weight cards, each a full-page link that calls
`setPaymentMethod` + navigates. No "next" button — one tap = chosen.

### Step 2a — Stellar pay (`/pagar/[id]/stellar`)

```
┌─────────────────────────────────┐
│ ← Voltar           ••42         │
├─────────────────────────────────┤
│  R$ 1.247,50 · CRIPTO           │
│  IMOBILIÁRIA ALVES              │
├─────────────────────────────────┤
│  [ XLM ]  USDC                  │
│  ≈ 38.94 XLM                    │
│  1 XLM = R$ 32,03 · 19:42       │
│  ┌─────────────────┐            │
│  │   [QR CODE]     │            │
│  └─────────────────┘            │
│  M2AB...K9PQ              [⎘]   │
│ [ ABRIR NO MEU APP ]            │
│  ● AGUARDANDO PAGAMENTO         │
│  ► Como funciona?               │
└─────────────────────────────────┘
```

Reuses `PaymentAddressQrCode`, `PaymentSummaryHeader`,
`HorizonPaymentPoller` as-is. New: asset tabs (XLM/USDC) atop a single
shared QR/address surface.

### Step 2b — PIX pay (`/pagar/[id]/pix`)

```
┌─────────────────────────────────┐
│ ← Voltar           ••42         │
├─────────────────────────────────┤
│  R$ 1.247,50 · PIX              │
│  IMOBILIÁRIA ALVES              │
├─────────────────────────────────┤
│  ┌─────────────────┐            │
│  │   [PIX QR]      │            │
│  └─────────────────┘            │
│ [ COPIAR PIX COPIA E COLA ]     │
│  00020126360014BR.GOV...   [⎘]  │
│  EXPIRA EM 04:58                │
│  ● AGUARDANDO CONFIRMAÇÃO       │
│  Emitido por ETHERFUSE BR LTDA  │
│  CNPJ 41.•••.•••/0001-•• · CVM  │
└─────────────────────────────────┘
```

QR + br-code from SEP-6 deposit response. New `PaymentStatePoller`
watches `payment.state` directly (anchor webhook flips state
server-side, Convex reactivity drives the UI).

### Step 3 — Confirmation (`/pagar/[id]/pago`)

```
┌─────────────────────────────────┐
│ MUTAV                      ••42 │
├─────────────────────────────────┤
│ ┃━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ │   ← 4px green stripe (only green)
│  ▣ PAGO                         │   ← Square + label, never green alone
│  R$ 1.247,50                    │
│  via PIX · 17/05/2026 14:32     │
│  ─────────────                  │
│  COMPROVANTE                    │
│  E2E ID                         │
│  E18236120•••0a91b7  [⎘]        │
│  CONTRATOS LIQUIDADOS           │
│  ▸ Locação Av. Paulista 1200    │
│  ▸ Locação R. Augusta 88        │
│ [ BAIXAR COMPROVANTE PDF ]      │
└─────────────────────────────────┘
```

State variants (`expired`, `canceled`, `failed`) reuse the shell, swap
the green stripe for the neutral border, swap the badge label, and
surface a recovery CTA.

## 3. Components

| Status | Component | Notes |
|---|---|---|
| Reuse | `PageContent variant="narrow"` | Wrap every step |
| Reuse | `PaymentSummaryHeader` | Add a `compact` prop for Steps 2/3 |
| Reuse | `PaymentAddressQrCode` / `HorizonPaymentPoller` / `AssetAmount` / `CopyableAddress` / `CopyableValue` | Stellar step unchanged |
| Reuse | `PublicHeader` / `PublicFooter` / `PublicShell` | Renter chrome |
| Reuse | `AppSidebar` + `SiteHeader` | Agency chrome (via conditional layout) |
| New  | `MethodPickerCard` | Tap-target card (≥88 px); icon + title + sub + duration |
| New  | `PaymentMethodTabs` | XLM/USDC tab strip (1 px border, no radius) |
| New  | `PixQrPanel` | Mirrors `PaymentAddressPanel` — QR + br-code + copy + countdown |
| New  | `PaymentCountdown` | Mono tabular-nums, accessible `<time>` + `aria-live="polite"` |
| New  | `PaymentStatePoller` | Generic; watches `payment.state` (used by Pix) |
| New  | `PaymentReceiptCard` | Step 3 surface with `data-stripe="paid"` |
| New  | `TrustStrip` | Anchor disclosure + CNPJ + last-4 |
| Extend | `PaymentStateTag` | Add `expired`, `canceled`, `failed` variants |

## 4. Accessibility + mobile

- **Focus order:** header → amount → method cards (Step 1) / primary
  CTA (Steps 2/3) → secondary disclosure → footer. Skip-to-content link
  in `PublicShell`.
- **Focus visible:** 1 px transparent baseline border on every
  focusable; on `:focus-visible` swap to `--color-amber`. No ring.
- **Touch targets:** ≥ 48 × 48 (≥ 88 px for method cards). Copy buttons
  span the whole row.
- **320 px reflow:** M-addresses + br-codes chunk every 4 chars and
  wrap with `overflow-wrap: anywhere`. QR is `min(240px, 80vw)`.
- **Reduced motion:** pulse dot becomes a static amber square; the
  countdown still updates (information, not decoration).
- **Live region:** state changes (`unpaid → paid`) announce via
  `aria-live="polite"` on the status row.
- **Color is never alone:** every state pairs a 6 × 6 square +
  JetBrains Mono uppercase label.

## 5. Copy (pt-BR canonical · en parity)

| Surface | pt-BR | en |
|---|---|---|
| Picker eyebrow | `COMO VOCÊ QUER PAGAR?` | `HOW DO YOU WANT TO PAY?` |
| PIX card title / sub | `PIX` / `Direto da sua conta · 1 min` | `PIX` / `From your bank account · 1 min` |
| Stellar card title / sub | `CRIPTO (STELLAR)` / `XLM ou USDC · ~10 s` | `CRYPTO (STELLAR)` / `XLM or USDC · ~10 s` |
| Stellar CTA | `ABRIR NO MEU APP` | `OPEN IN MY WALLET` |
| PIX CTA | `COPIAR PIX COPIA E COLA` | `COPY PIX CODE` |
| Waiting | `AGUARDANDO PAGAMENTO` / `AGUARDANDO CONFIRMAÇÃO` | `AWAITING PAYMENT` / `AWAITING CONFIRMATION` |
| Paid | `PAGO` | `PAID` |
| Trust strip | `Pagamentos processados pela Etherfuse (PIX, regulada CVM) e Stellar (cripto)` | `Payments processed by Etherfuse (PIX, CVM-regulated) and Stellar (crypto)` |
| Receipt CTA | `BAIXAR COMPROVANTE PDF` | `DOWNLOAD RECEIPT PDF` |
| Expired recovery | `Este link expirou. Solicite um novo à imobiliária.` | `This link expired. Request a new one from the agency.` |

Tone: declarative, never apologetic. No exclamation marks. No emoji.
Method names always uppercase mono; surrounding prose sentence case.

## Findings

- **State drives URL, not React state.** The layout `redirect()`s based
  on `payment.method` / `state` so the URL is canonical, refreshable,
  and back-button-correct. Replaces the drawer pattern cleanly.
- **Third method (boleto / card) drops in as a third
  `MethodPickerCard` + `/pagar/[id]/boleto/page.tsx`** — no
  architecture change. The picker grid is `grid-cols-1 md:grid-cols-2`
  today; goes `lg:grid-cols-3` when the third lands.
- **Agency vs renter chrome is a layout concern**, not a page concern —
  same step components render in both.
- **The Pix flow's "waiting" state is the same UX shape as Stellar's**
  (QR + copy + pulse + live state) — reusing the visual contract avoids
  teaching users two patterns.
- Relevant existing files: `src/app/[locale]/(public)/pagar/[publicId]/endereco/page.tsx`,
  `src/components/payments/flow/`, `.design/projects/payment-flow/design/INDEX.md`.
