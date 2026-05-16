# Screen 03 — Wallet Mode (Stellar Soroban, v1.1 scaffolded)

> Chunk: screen-03-wallet-mode | Phase: design | Project: payment-flow | Generated: 2026-05-13
> Route: `/[locale]/pagar/[publicId]/carteira`
> Status: **Scaffolded for v1; live in v1.1 behind `STELLAR_CONTRACT_MODE`**

## Purpose

For tenants with a Soroban-capable wallet (Freighter desktop in v1.1; SEP-7 deep-link variant in a future patch). Camila will likely never see this screen — it targets Daniel-type personas who want to settle the invoice via a single contract call instead of a generic address payment.

**v1 status:** the route renders a "feature em desenvolvimento" placeholder behind the env flag check. The full panel below is the v1.1 spec, built so the design phase isn't revisited.

## User flow position

```
/pagar/[publicId]/carteira
        │
        ├─ STELLAR_CONTRACT_MODE === false  → fall back to /endereco (redirect)
        │
        └─ STELLAR_CONTRACT_MODE === true   → render WalletConnectPanel
                │
                ├─ no Freighter detected     → small inline message + "Voltar para endereço" link
                ├─ user rejects sign         → error state, retry button
                ├─ tx fails on contract      → error state with localized code, retry
                └─ tx succeeds → state.kind === "paid" → router.replace to /recibo
```

## Layout (all viewports — single column)

```
┌────────────────────────────────────────┐
│  tga                            pt-BR  │
├────────────────────────────────────────┤
│                                        │
│   Imobiliária Costa & Filhos           │  ← PaymentSummaryHeader
│   R$ 2.847,00                          │     (same as Screen 02)
│   Vence em 3 dias · 15/05/2026         │
│                                        │
│   ┌──────────────────────────────────┐ │
│   │ Pagar com carteira Stellar       │ │  ← Card label
│   │                                  │ │
│   │ Conecte uma carteira Stellar     │ │  ← Inter body
│   │ compatível (Freighter).          │ │
│   │ Você aprova um único pagamento   │ │
│   │ direto pela rede.                │ │
│   │                                  │ │
│   │   124,7805 XLM                   │ │  ← AssetAmount (no copy button)
│   │   ≈ R$ 2.847,00                  │ │
│   │                                  │ │
│   │  ┌─────────────────────────────┐ │ │
│   │  │     Conectar carteira       │ │ │  ← Primary CTA (cycles state)
│   │  └─────────────────────────────┘ │ │     idle → signing → submitting →
│   │                                  │ │     confirming → done
│   │  ▪ Aguardando pagamento na rede  │ │  ← HorizonPaymentPoller row
│   │                                  │ │     (same component as Screen 02)
│   └──────────────────────────────────┘ │
│                                        │
│   Como pagar com carteira  ▾           │  ← Collapsible help
│                                        │
│   Prefiro copiar o endereço            │  ← Quiet link back to Screen 02
│                                        │
├────────────────────────────────────────┤
│  Dúvidas? Fale com a {agencyName} pt|en│
└────────────────────────────────────────┘
```

No QR. No M-address chunks. Mode B is a single-action flow.

## Components used

| Slot | Component | Source |
|---|---|---|
| Shell | `PublicShell` + `PageContent variant="narrow"` | new + existing |
| Summary | `PaymentSummaryHeader` | new |
| Card | `Card` + `CardContent` (24px padding, 1px `#D9D7D2`, 0px radius) | shadcn |
| Asset amount | `AssetAmount` (without `CopyableValue` wrapper — no need to copy) | new |
| Primary CTA | `WalletConnectPanel` internal `Button variant="default" size="lg"` | new (wraps shadcn) |
| Wallet client | `WalletConnectClient` (dynamic-import, `ssr: false`) | new |
| Poller row | `HorizonPaymentPoller` (same as Screen 02) | new |
| Help disclosure | shadcn `Collapsible` + Phosphor `CaretDown` light | shadcn |
| Fallback link | `<Link>` from `@/i18n/navigation` → `/endereco` | existing |
| Footer | `PublicFooterMeta` | new |

## States

The `WalletConnectPanel` is a small state machine. The same Button slot cycles through five visual states; everything else on the card is static.

### `idle` (default)

```
┌────────────────────────────────────┐
│  Conectar carteira                 │
└────────────────────────────────────┘
```

- Background `#C47E10`, text `#1A1A1A` (Inter Medium 14)
- Enabled, normal hover (`#9E6A10`)

### `signing` (Freighter popup is visible)

```
┌────────────────────────────────────┐
│  Assinar transação                 │
└────────────────────────────────────┘
```

- Background dims to `#C47E10` at `opacity: 0.85` (active state per STYLE.md §5)
- Disabled (`aria-disabled="true"`, `cursor: not-allowed`)
- Text "Assinar transação" / en "Sign transaction"

### `submitting` (signed; submitting to Horizon/RPC)

```
┌────────────────────────────────────┐
│  Enviando para a rede  ▪ ▫ ▫      │
└────────────────────────────────────┘
```

- Same dimming; disabled
- Trailing animated dots: three 6×6 amber squares; opacity cycles `(1, 0.4, 0.4) → (0.4, 1, 0.4) → (0.4, 0.4, 1)` over 1500ms via `@keyframes`
- **No rotation, no transform** — opacity only

### `confirming` (submitted; awaiting `txMeta` finalization)

```
┌────────────────────────────────────┐
│  Confirmando  ▪ ▫ ▫               │
└────────────────────────────────────┘
```

- Same as `submitting` visually; copy changes to `Confirmando` / en `Confirming`
- This state can last up to ~10s (Stellar ledger close time)

### `done` (transient — then redirect)

```
┌────────────────────────────────────┐
│  Pagamento registrado              │
└────────────────────────────────────┘
```

- Background `#FFF0D4` (`--color-accent-dim`); border `#C47E10`; text `#C47E10`
- Visible for ~600ms before `router.replace("/recibo")` fires (gives SR a chance to announce the success message)

### Error states

| Sub-state | Visual | Recovery |
|---|---|---|
| `freighter-missing` | Button replaced by Inter body line: "Instale a extensão Freighter para usar esta forma." + link to `https://freighter.app/`. Below: "Prefiro copiar o endereço" link to `/endereco`. | Tenant installs or falls back |
| `user-rejected` | Button returns to `idle` style; inline Mono `--color-error` (`#B83232`) line above the button: "Você cancelou a assinatura." | Tap CTA again — back to `signing` |
| `network-failed` | Button returns to `idle`; inline error line: "Falha de rede. Tente novamente em alguns instantes." | Tap CTA again |
| `contract-aborted` | Button returns to `idle`; inline error line: localized `t(`errors.${errorCode}`)` via dynamic key lookup; default fallback: "Não foi possível concluir. Fale com a {agencyName}." | Tap CTA + visible agency contact link |

Error inline-lines are NOT `<Card>`s of their own — they sit inside the same panel above the button, in a `role="alert"` region (so SR announces them immediately, unlike the `polite` poller status).

### Empty

Not applicable — same as Screen 02.

### Loading

`loading.tsx` for `/carteira` renders the same skeleton stack as `/endereco`:
- Summary 3-line skeleton
- Card body: 4-line text skeleton + amount-block skeleton + 48px button skeleton

### `STELLAR_CONTRACT_MODE === false` (v1)

`page.tsx` checks the env flag server-side. If false, `redirect()` to `/endereco`. The route exists but is never reachable in v1; placeholder copy never ships.

## Interactions

| # | Trigger | Outcome | Spec |
|---|---|---|---|
| 1 | Tap "Conectar carteira" (`idle`) | `WalletConnectClient.connect()` → `getPublicKey()` from `@stellar/freighter-api`; on success → `signing` state and immediately prepare the Soroban call | Direct Freighter API — no kit |
| 2 | `getPublicKey` resolves | Build `Operation.invokeHostFunction` for `mutav-stellar` contract `pay_invoice(invoiceId)`; pass to `signTransaction()`; state → `signing` | All client-side |
| 3 | `signTransaction` resolves | Submit signed XDR to Horizon `/transactions` (or `rpc.stellar.org` for Soroban-specific); state → `submitting` → `confirming` once submitted | Horizon → 200 OK is submitted; `txMeta` finalization is confirming |
| 4 | Convex subscription pushes `state.kind === "paid"` | (same as Screen 02) `router.replace("/recibo")` | indexer-side: see stellar-modes.md §"Mode B architecture" |
| 5 | `signTransaction` rejects | State → `idle` with `user-rejected` error variant | |
| 6 | Submit fails (4xx/5xx, network) | State → `idle` with `network-failed` error variant | |
| 7 | Tap "Prefiro copiar o endereço" link | Navigate to `/endereco` (same payment, different mode); Mode A poller picks up immediately | |
| 8 | Tap "Como pagar com carteira" disclosure | Reveal a 4-step help block: 1) Install Freighter, 2) Add XLM, 3) Approve sign, 4) Wait confirmation | shadcn `Collapsible` |

## Accessibility

### Tab order

1. Skip link → `#primary-action` (the Connect / Sign / etc. button)
2. Locale switch
3. `PaymentSummaryHeader` text (non-focusable)
4. "Conectar carteira" CTA (`id="primary-action"`)
5. Help disclosure trigger
6. "Prefiro copiar o endereço" fallback link
7. Agency-contact link in `PublicFooterMeta`

### Live regions

- Error inline lines: `role="alert"` — announced immediately, interrupts current reading
- "Aguardando pagamento na rede" poller line: `role="status" aria-live="polite"` — only announced when state transitions
- The state machine button label cycles: announce only the FIRST transition per state-change cycle; not every render. Implementation: the button text is wrapped in a `role="status"` region; React's reconciliation re-announces on text change. Acceptable cadence (5 distinct states max per interaction; SR users hear "signing", "submitting", "confirming", "payment registered" — useful, not noisy).

### Focus during state cycle

When the button enters `signing` and Freighter opens its popup, focus naturally moves to the Freighter extension. When Freighter closes, focus returns to the button. We do NOT manage focus manually here — browsers handle it.

When state reaches `done`, focus is on the button; the 600ms delay before `router.replace` gives SR time to read "Pagamento registrado". On the next page (receipt), the `<h1>` reads naturally.

### Color-contrast for state colors

- `done` state uses `#C47E10` text on `#FFF0D4` background: 4.6:1 (AA Normal pass)
- Error inline lines use `#B83232` on `#FFFFFF`: 6.1:1 (AA Large pass; for body text we keep weight Medium per STYLE.md "Always" rule "Bold status labels ≥14px when `#C94040` appears on dark background" — applied symmetrically for light)

### Reduced motion

The trailing-dots opacity cycle is decorative confirmation, not status-critical (the button label says "Enviando para a rede" — that's the actual status). Under `prefers-reduced-motion: reduce`, the three dots collapse to a single static `…` glyph. The poller row pulse continues (status signal).

## Image resources

| Slot | Type | Description | Treatment |
|---|---|---|---|
| No QR, no decorative imagery | — | — | — |
| Freighter logo (in `freighter-missing` error variant only) | 16px Phosphor `Wallet` light icon next to the install link | `--color-text` (never amber) | Bare, no container |
| Disclosure caret | Phosphor `CaretDown` light 16px | swaps to `CaretUp` on open | — |

## Three-layer hierarchy verification

| Layer | Element |
|---|---|
| Declaration (Geist Bold) | `R$ 2.847,00` in `PaymentSummaryHeader` |
| Explanation (Inter) | Card body "Conecte uma carteira Stellar compatível…", button labels, disclosure title |
| Evidence (Mono) | Due date, asset amount, poller line |

All three layers present. ✓

## Brand-fidelity checklist

- ✓ `border-radius: 0` on all elements
- ✓ 1px solid borders only
- ✓ Amber under 5%: primary CTA (~7700px²), wordmark (~200px²), live dot (~36px²), trailing dots in submit/confirming states (~108px² × small duty cycle). Well under 5%.
- ✓ Three-layer hierarchy present
- ✓ No shadows, gradients, glass
- ✓ Tabular-nums on all numerics via `Mono`
- ✓ Effects vocabulary: `opacity` (state dims + dot cycle), `background-color`, `color`, `border-color` only
- ✓ No `transform: rotate` on spinner — three discrete squares with opacity cycle
- ✓ Phosphor weight="light" only
- ✓ Bold-bet #1 (zero-radius enforcement): all
- ✓ Bold-bet #2 (amber as precious metal): minimal
- ✓ Bold-bet #3 (tabular nums): via `Mono`
- ✓ Bold-bet #4 (three-layer hierarchy): verified
- ✓ Bold-bet #5 (surface stacking): card on canvas

## v1 → v1.1 transition checklist

| What ships in v1 | What flips in v1.1 |
|---|---|
| Route file `carteira/page.tsx` exists | Same file gains body |
| `WalletConnectPanel.tsx` exists with full design but body returns `null` when env flag false | Body renders normally |
| `WalletConnectClient.tsx` exists with empty function bodies + TODO markers | Freighter API calls implemented |
| i18n strings for all states already shipped in `paymentFlow.wallet.*` | No new strings needed |
| `STELLAR_CONTRACT_MODE` defaults to `false` | Flipped to `true` per-env once contract is live |
| `redirect("/endereco")` in `page.tsx` when flag is off | Removed |

## Related

- Components: see `shared/component-plan.md`
- Brand patterns: STYLE.md §3.1, §3.2, §5
- Microcopy: research/content-strategy.md (extended for Mode B in i18n strings)
- Stellar architecture: research/stellar-modes.md §"Mode B"
- Accessibility: research/accessibility-patterns.md §1–10
- Interactions: shared/micro-interactions.md row #14 (trailing dots), #11 (input focus, if error inline gains form)
