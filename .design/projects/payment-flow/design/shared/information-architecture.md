# Information Architecture

> Chunk: information-architecture | Phase: design | Project: payment-flow | Generated: 2026-05-13

## Route tree

The flow lives in a new `(public)` route group, sibling to the existing `(app)` group. The group's `layout.tsx` strips all authenticated chrome, forces the Imobiliárias light theme, and renders only the brand mark + agency name.

```
src/app/[locale]/
├── (app)/                          # existing authenticated dashboard — untouched
│   └── …
├── (public)/                       # NEW — public group
│   ├── layout.tsx                  # forces theme="light", data-front="imobiliarias"
│   ├── pagar/
│   │   └── [publicId]/
│   │       ├── page.tsx            # 1 — Landing / mode resolver (Screen 01)
│   │       ├── error.tsx           # 6 — Error boundary  (Screen 06)
│   │       ├── not-found.tsx       # 7 — Not found       (Screen 07)
│   │       ├── endereco/
│   │       │   └── page.tsx        # 2 — Address mode    (Screen 02)
│   │       ├── carteira/
│   │       │   └── page.tsx        # 3 — Wallet mode B   (Screen 03, v1.1, flagged)
│   │       ├── recibo/
│   │       │   └── page.tsx        # 4 — Receipt         (Screen 04)
│   │       └── encerrado/
│   │           └── page.tsx        # 5 — Expired/canceled (Screen 05)
```

## Routing decisions

| Decision | Rationale |
|---|---|
| `/pagar` not `/pay` | pt-BR is canonical; locale segment carries language switch. `/en/pagar` is acceptable — verb is brand-consistent. |
| `publicId` in URL, not query string | Cleanly addressable; copy/paste forwarding works; matches `payment.publicId` 1:1. |
| Sub-routes per execution mode | `endereco` vs `carteira` are different UIs; sharing one route with a `?mode=` query would merge their meta tags and complicate `loading.tsx`. |
| Receipt as separate route | Persistent share URL (per A6 in `recommendations.md`); also lets the route's `<h1>` get the natural SR announcement on navigation. |
| `encerrado` over multiple routes | One layout serves `overdue`, `canceled`, and any future terminal-but-not-paid state. Variant chosen at render via `state.kind`. |

## Hierarchy on each screen (three-layer law)

Every screen must contain exactly:

1. **One Geist Bold declaration** — the status or the action ("Pagamento de aluguel", "Endereço de pagamento", "Pagamento confirmado")
2. **At least one Inter explanation** — agency name, contract reference, network hint, due date prose
3. **At least one JetBrains Mono evidence element** — amount, address, ledger #, txHash, paidAt

The `PaymentSummaryHeader` carries the full triplet — it is reused on every authenticated execution and informational screen (01, 02, 03, 04, 05), guaranteeing layer compliance.

## Component hierarchy

```
PublicShell (route-group layout)
└── PageShell (existing primitive)
    └── PageContent variant="narrow"           ─ caps at 56rem, py-6/py-10
        ├── PaymentSummaryHeader               ─ agency + amount + due date (or paidAt)
        ├── <mode panel>                       ─ varies by route
        │   ├── PaymentAddressPanel            ─ Screen 02 (Mode A)
        │   ├── WalletConnectPanel             ─ Screen 03 (Mode B, flagged)
        │   ├── PaymentReceiptCard             ─ Screen 04
        │   └── PaymentExpiredCard             ─ Screen 05
        └── PublicFooterMeta                   ─ agency-contact line + locale switch
```

## Grouping rationale

- **Top-of-page summary** is always the same regardless of state — Camila must never have to scroll to confirm she is paying R$ X to Y agency.
- **Mode panel** holds the *one* primary action of the page (or, for receipt, the evidence). One CTA per screen — secondary actions become quiet text-links inside the panel.
- **Footer meta** holds the WhatsApp / phone contact for the agency and a locale toggle. Outside the panel, deliberately low contrast.

## Out-of-flow (deferred / not in this design)

- Per-agency settings screen (`/configuracoes/pagamentos`) — agency selects default mode and source G-account. Lives inside the existing `(app)` group; not part of this design phase.
- Tenant magic-link generator — UI lives on the existing `/payments/[id]` detail page; out of this scope.
- Admin reconciliation queue for `unmatchedDeposits` — back-office surface, not tenant-facing.
