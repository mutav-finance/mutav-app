# Micro-Interactions

> Chunk: micro-interactions | Phase: design | Project: payment-flow | Generated: 2026-05-13

Effects vocabulary follows STYLE.md §5 strictly. Only `color`, `background-color`, `border-color`, `opacity` transition. **No `transform`, no `scale`, no `translate` on any interaction.** Motion intensity dial = 2.

## Master table — every state change in the flow

| # | Trigger | Element | Animation | Duration | Easing | Notes |
|---|---|---|---|---|---|---|
| 1 | Hover on primary CTA | `Button variant="default"` (amber fill) | `background-color: #C47E10 → #9E6A10` | 150ms | ease-out | Brand contract; text stays `#1A1A1A` |
| 2 | Focus on primary CTA | same | `border-color: #C47E10 → still #C47E10` + 1px shift via box-shadow `inset` to make the 1px focus ring readable | immediate | — | **No outline, no offset ring.** Implementation uses `outline: none` + the natural 1px border. |
| 3 | Active (pointer down) on primary CTA | same | `opacity: 1 → 0.85` | 80ms | linear | Per STYLE.md §5 active spec |
| 4 | Hover on secondary CTA | `Button variant="outline"` (amber outline) | `background-color: transparent → #FFF0D4` | 150ms | ease-out | Imobiliárias column of STYLE.md §3.3 |
| 5 | Hover on copy icon button | `CopyableValue` button | `border-color: #D9D7D2 → #C47E10` + `color: #6B6860 → #1A1A1A` | 150ms | ease-out | No background change — the button is a flat icon-in-square |
| 6 | Click on copy button | same | icon swap `Copy → Check` (no animation — instant glyph swap); button briefly disabled 1.6s | — | — | Sonner toast fires concurrently; no rotation, no fade between glyphs |
| 7 | Toast appear | Sonner `role="status"` | `opacity: 0 → 1` | 200ms | ease-out | Sonner default transform-slide is **disabled** via `prefers-reduced-motion: reduce` always-applied global override (effective for all users in this flow — matches motion: 2 dial) |
| 8 | Toast dismiss | Sonner | `opacity: 1 → 0` | 200ms | ease-out | Auto after 3s |
| 9 | Live poll dot (Mode A) | 6×6 amber square | `opacity: 1 → 0.4 → 1` infinite | 2s | linear | The ONLY ambient animation in TGA. Single dot per page. STYLE.md §5. |
| 10 | Tab toggle change (Mode A ↔ B) | shadcn `Tabs trigger` | `color: --color-text-2 → --color-text` + `border-bottom-color: transparent → --color-accent` | 150ms | ease-out | Active-state border is bottom-only, 1px |
| 11 | Form input focus (Mode B wallet error) | shadcn `Input` | `border-color: #D9D7D2 → #C47E10` | 150ms | ease-out | No ring per STYLE.md §3.4 |
| 12 | State change `pending → paid` (server-pushed) | page-level | `router.replace` to `/recibo`; receipt page renders fresh | — | — | No transitional animation; Convex subscription triggers route swap. The receipt's `<h1>` reads naturally on SR navigation. |
| 13 | Receipt landing | `PaymentReceiptCard` | none — instant render | — | — | Per content-strategy: no celebration. The 4px `#2E8B5A` top stripe is the entire arrival signal. |
| 14 | Mode B `idle → signing → submitting → confirming → done` | `WalletConnectPanel` button | `background-color` cycle + text content swap; trailing mono dots `. → .. → ...` cycle every 500ms via `@keyframes` on `opacity` | 500ms per dot | linear | No rotation. The "spinner" is three discrete amber squares with phased opacity. |
| 15 | Tap on full method card (mode toggle, when shown) | card surface | `background-color: #FFFFFF → #EEEDEA` on hover; on tap, the tab `data-state=active` fires (#10) | 150ms | ease-out | Whole card target ≥48px tall |
| 16 | Skip link reveal | `<a>` inside `PublicShell` | only on `:focus`: `top: -100% → 0` via `transform: translateY` | immediate | — | **This is the single exception** to the transform rule, justified by WCAG 2.4.1 and standard skip-link patterns; never user-perceived as motion |
| 17 | Error boundary mount | `error.tsx` | none | — | — | Renders flat |
| 18 | Stellar explorer link hover | `StellarExplorerLink` | `text-decoration: underline` appears (was none); color unchanged | 150ms | ease-out | Never amber — link uses `--color-text` |

## Gesture definitions

| Gesture | Behavior |
|---|---|
| Tap on amber CTA | Fires `onClick`. No visual delay. The 1.6s icon-swap on copy is the ONLY post-tap state. |
| Tap on M-address chunk | No-op visually. Copy is on the dedicated copy button only (avoids accidental text-selection toggling). |
| Long-press on M-address | Native OS selection; we don't override. Useful for users who paste manually. |
| Two-finger zoom | Not blocked. The QR uses `width="240"` not `width="100%"`; user can pinch-zoom for readability. |
| Pull-to-refresh on iOS Safari | Not blocked. Refresh re-runs the RSC; safe with Convex idempotency. |

## Reduced-motion override

`@media (prefers-reduced-motion: reduce)` block in `globals.css`:

- The pulse dot (animation #9) keeps animating — it's a status signal, not decoration. Per WCAG 2.3.3 "Animation from Interactions," ambient state animations under 5s loop are not regulated. We do, however, swap `linear infinite` for a static amber square — Convex's subscription is the actual paid-detection mechanism; the dot is reassurance, not necessity.
- The Mode B "submitting" dots (#14) collapse to a single static `…`.
- Toast fade (#7, #8) becomes instant (opacity: 1 immediately).
- All other entries already use no transform; reduced-motion is a no-op.

## Anti-patterns explicitly avoided

- **No checkmark draw-on animation** on receipt — Tailwind/Framer SVG path-draw is forbidden by the brand voice ("no celebration"). Confirmation lands instantly.
- **No spinner with rotation** anywhere — Mode B's `confirming…` state uses three-square opacity cycle.
- **No skeleton shimmer** — shadcn's default shimmer animation is overridden globally to a static `--color-surface-2` fill. The brand's surface stacking provides the depth signal.
- **No gradient sweep on the live dot** — opacity pulse only.
- **No address-chunk fade-in** — the M-address SSR-renders fully visible.
- **No countdown ticker** — Mode A has no expiration countdown (the muxed address remains valid for the invoice lifetime). The poll dot is the only live element.
