# Alternative Directions — Contract Details

> Two genuinely different redesign approaches. The shipped page is the third (current) direction — a centered single-column stack of cards. These two are deliberately different starting points, not incremental refinements.

---

## Direction A — "Ledger view" (terminal-leaning, evidence-first)

**Concept:** The page is a single dense ledger inspired by Bloomberg-terminal contract pages. One viewport, no scrolling on desktop. The four BRIEF questions answered by quadrants.

**Layout:**

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ TGA / contracts / #6f3a-2025-1109                              [Active ●]    │
├────────────────────────────────────┬─────────────────────────────────────────┤
│ Contract                           │ Tenant                                   │
│ #6f3a-2025-1109                    │ Maria Eduarda dos Santos                 │
│ R$ 14,890.00 available             │ CPF 142.365.099-31                       │
│ Renews 2025-11-09                  │ Term approved 2025-09-12 14:23           │
├────────────────────────────────────┼─────────────────────────────────────────┤
│ Economics              R$          │ Documents                                │
│ Rent                2,500.00       │ Rental contract           [APROVADO]    │
│ Condo                 845.00       │ Inspection                [PENDENTE]    │
│ Other fees              0.00       │ Policy                    [APROVADO]    │
│ Total              3,345.00        │                                          │
├────────────────────────────────────┴─────────────────────────────────────────┤
│ History                                                          [+15 more]  │
│ 2025-11-01 09:18  Rent collected · R$3,345.00                                │
│ 2025-10-31 14:00  Renewal scheduled                                          │
│ 2025-09-12 14:23  Term approved                                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

**Trade-offs:**

| Pro | Con |
|-----|-----|
| Maximum density — every fact in one viewport | Hostile to first-time users; learning cost is high |
| Reads as a serious financial instrument; Lucas feels like he's using protocol-grade tooling | Too dense for the Imobiliárias persona (BRIEF density target = 4, not 7) |
| The three-layer hierarchy is structural, not decorative — Geist top-left, Inter labels, Mono everywhere else | No room for the promo banner; cross-sells need a different surface |
| Mobile becomes a long single-column scroll; clear breakpoint logic | Less generous to action menus; the disabled-state communication problem gets worse |
| Investidor and Imobiliárias could share one page template, only swapping density | Photography (which the brand allows for Imobiliárias) has no place here |

**When to pick this:** If the next persona research reveals Lucas is a power-user who returns to this page daily. Or if the protocol pivots to selling "operator tooling for imobiliárias" rather than "structured warmth."

---

## Direction B — "Document spine" (workflow-leaning, action-first)

**Concept:** Reframe the page around the *next document or decision the imobiliária needs to ship*, not around the contract's static facts. The status hero becomes a workflow checklist; the contract data is a sidebar.

**Layout:**

```
┌─────────────────────────────────────────────────┬──────────────────────────┐
│ Próximas ações                                   │ Contrato                  │
├─────────────────────────────────────────────────┤ #6f3a-2025-1109           │
│ ●  Vistoria pendente                             │                          │
│    Solicite a inspeção do imóvel                 │ Status      [ATIVO]      │
│    [Enviar vistoria] [Adiar 7 dias]              │ Renovação   2025-11-09   │
├─────────────────────────────────────────────────┤ Fiança      R$14,890.00  │
│ ○  Apólice (aguardando vistoria)                 │                          │
│    Bloqueada até a vistoria ser enviada          ├──────────────────────────┤
├─────────────────────────────────────────────────┤ Inquilino                 │
│ ✓  Contrato de locação                          │ Maria Eduarda             │
│    Aprovado 2025-09-12                          │ Termo Aprovado 2025-09-12 │
├─────────────────────────────────────────────────┤                          │
│ Histórico                                        │ Locação                   │
│ 2025-11-01  Aluguel coletado                     │ R$ 3,345.00 / mês        │
│ 2025-10-31  Renovação agendada                   │ Multiplicador 12x        │
│ 2025-09-12  Termo aprovado                       │ Setup 6x                 │
└─────────────────────────────────────────────────┴──────────────────────────┘
```

**Trade-offs:**

| Pro | Con |
|-----|-----|
| Action-oriented — opens with what the imobiliária needs to do, not what's already true | Requires real workflow data (today's docs are static fixtures); deeper Convex wiring before useful |
| Disabled-button problem (C5) dissolves: actions only render when actionable | Breaks the BRIEF's "answer four questions" frame — this answers "what's next?" instead |
| The sidebar's compact summary becomes the same component used on the contracts list page hover preview — reusable | Adds a navigation layer (workflow filter, urgency sorting) that doesn't exist yet |
| Fits the Caregiver archetype better — "we'll guide you through this, here's the next step" | Two-column layout is harder to translate to mobile cleanly |
| The promo banner finds its natural home: above the workflow column, contextually relevant ("delinquency? here's Quita Loft") | More opinionated about workflow assumptions; gets stale faster as features evolve |

**When to pick this:** Once mutations exist (edit, send, approve). The current page is read-only; this direction needs writes to earn its layout.

---

## Honest comparison

The shipped direction is the right starting point. It is brand-faithful, content-clear, and ship-ready. The two alternatives above are not "better" — they're futures. Direction A becomes correct if the protocol leans into operator tooling. Direction B becomes correct once mutations land and the page has actions to organize.

For the next two sprints, the shipped direction with the [`prioritized-fixes.md`](./prioritized-fixes.md) applied is the recommendation. Revisit alternatives at the next quarter's planning.

---

## Cross-references

- [`critique.md`](./critique.md)
- [`prioritized-fixes.md`](./prioritized-fixes.md)
- [`strengths.md`](./strengths.md) — what to preserve in any redesign
