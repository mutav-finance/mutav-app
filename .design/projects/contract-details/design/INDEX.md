# Design — Contract Details

> Phase: design (retroactive) | Project: contract-details | Brand: TGA | Front: Imobiliárias

The page is implemented at `src/components/contracts/contract-details-page.tsx`. These chunks describe the design as built, derived from the code, so the critique has structured inputs.

## Chunks

- [Information Architecture](information-architecture.md) — page composition, section order, content hierarchy
- [Components](components.md) — primitives introduced (Mono, StatusTag, FieldRow, FieldGroupHeader) and shadcn primitives used
- [Typography](typography.md) — three-layer hierarchy mapping (Geist / Inter / JetBrains Mono) on this route
- [Color & Tokens](color-tokens.md) — token usage map, contrast assumptions, status semantics
- [States](states.md) — loaded, empty, disabled, collapsed; explicit gaps (loading, error)
- [Interactions](interactions.md) — breadcrumb, action menu, collapsible history, button affordances
- [Accessibility Intent](accessibility-intent.md) — what was deliberately added (skip link, aria-label, aria-hidden), what's still open
