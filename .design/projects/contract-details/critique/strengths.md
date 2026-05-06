# Strengths — Contract Details

> What works. To be preserved across any redesign or refactor.

---

## 1. The `<Mono>` component is the brand argument made structural

`src/components/ui/mono.tsx` is 18 lines that ship the page's most important brand promise. Every numeric value pipes through it, every value gets `font-feature-settings: "tnum" 1`, every value carries `data-mono` for queryability. This is STYLE.md Bold Bet 3 ("tabular numerals on every number, without exception") implemented as a **constraint**, not a guideline. It cannot be forgotten because the type system and the lint surface both fight you if you bypass it.

Preserve. Promote to other routes (dashboard cards, transaction list, NAV display).

---

## 2. `<StatusTag>` is the badge problem solved correctly

The page has three different status surfaces (contract status, document status, tenant approval). All three use the same primitive. The primitive renders the brand-mandated 6×6 colored square + Mono uppercase 11px label, with the square `aria-hidden` and the label carrying meaning.

This is exactly STYLE.md §3.5. The square never reads alone, the label never reads alone, and the text-color override (`text-foreground`, not the tone color) keeps every label at full contrast independent of the tone hue. WCAG 1.4.1 (color is not the only means) is satisfied by structure, not by post-hoc audit.

Preserve.

---

## 3. The `<dl>/<dt>/<dd>` semantic on every label-value pair

Rental data, property data, optional metadata, tenant personal info — all rendered through `FieldRow` which is a real description list. Screen-reader users hear `"Aluguel: R$ 2,500.00"` as a paired definition, not as two adjacent strings. The page's reading order is structurally announceable.

Preserve and extend: any future card with label/value content should use the same primitive.

---

## 4. The empty-state vocabulary is consistent

- `FieldRow` empty: `—` em-dash (not hyphen, not "N/A," not blank).
- History empty: localized "Sem registros." / "No records."
- Disabled buttons: shadcn's `disabled:opacity-50` (consistent visual signal).
- Conditional footer: `{tenant.termApprovedAt && (...)}` — the section either appears with full evidence or doesn't appear at all (no half-rendered "Term Approved: —").

This is small but it adds up. The page has *no* visible "TODO" residue.

Preserve.

---

## 5. Surface stacking creates depth without shadows

Three intentional layers — `bg-background` (canvas `#F7F6F3`), `bg-card` (white `#FFFFFF`), `bg-secondary` (`#EEEDEA` for icon containers and FieldGroupHeader bars). The eye reads hierarchy through tonal stepping, exactly per STYLE.md Bold Bet 5. Zero `box-shadow` anywhere — the page is shadowless and still has depth.

Preserve. Resist any future PR that adds a "subtle shadow for elevation" — the answer is always to step the surface color instead.

---

## 6. The localization is real, not retrofit

Every string is `useTranslations` from day one. pt-BR is canonical and EN is parity. Field labels are domain-precise pt-BR ("Multiplicador locatício," "Pagamento efetuado," "Termo Aprovado") — translated by someone who knows the imobiliária business, not by Google Translate. The hero title interpolates the localized status, so "Contrato Ativo" / "Active Contract" is always grammatical in both languages.

Preserve. Hold the line: any new copy that ships in only English will rot the brand's "structured warmth for Brazilian imobiliárias" promise.

---

## 7. The accessibility-by-construction details

- Skip-link styling exists globally (just needs the anchor — see C3).
- Focus ring is `outline: 1px solid var(--accent)` with offset 2px on every focusable element via `*:focus-visible`. No glow, no ring, no `box-shadow` — STYLE.md focus spec.
- `aria-hidden` on every decorative square and check icon.
- `aria-label` on the history collapse trigger swaps with state.
- `prefers-reduced-motion` respected globally for the live-pulse class.
- `<html lang={locale}>` set correctly per route.

These are not flashy fixes — they're structural choices that prevent accessibility debt from accumulating.

Preserve and extend.

---

## 8. The hero declaration pattern is a strong opening move

`<h1>{t("heroTitle", { status: tStatus(contract.status) })}</h1>` — Geist Bold 28px declaring "Contrato Ativo" / "Contrato Pendente." This is the Caregiver-meets-Ruler opening: human language declaration + machine status. When fix C4 lands and this becomes the *only* Geist Bold declaration on the page, it will sing.

Preserve, but enforce singularity (see C4).

---

## 9. The promo banner uses `--accent-dim`, not `--accent`

`bg-accent-dim` resolves to `#FFF0D4` — the warm cream surface, not amber proper. STYLE.md §3.1 names `#FFF8EE` as the "Caregiver's signal: something good is happening here" — promo banner uses the equivalent token. The CTA inside uses amber proper. This is the correct nesting: a 60-30-10 composition fragment inside a single banner.

Preserve.

---

## 10. The page ships nothing it can't justify

No decorative dividers. No "engagement" copy. No icons-without-purpose. Every element on the page traces to a function: status, money, dates, documents, history, tenant, tenant approval. The promo banner is the only non-functional element, and it's bounded — one banner, one CTA, one cream surface.

This restraint is what STYLE.md calls Precision Brutalism. The page is brutal in the original Le Corbusier sense — every element exposes its purpose. Preserve this disposition above any specific implementation detail.

---

## Cross-references

- [`critique.md`](./critique.md)
- [`prioritized-fixes.md`](./prioritized-fixes.md)
- [`alternative-directions.md`](./alternative-directions.md)
