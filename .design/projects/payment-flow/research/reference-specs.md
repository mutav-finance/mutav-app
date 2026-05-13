# Reference Specs — Collected URLs & Key Takeaways

> Phase: research | Project: payment-flow | Date: 2026-05-13

## 1. BCB PIX EMV BR Code (the QR payload)

**Primary spec:** [Manual de Padrões para Iniciação do Pix v2.9.0](https://www.bcb.gov.br/content/estabilidadefinanceira/pix/Regulamento_Pix/II_ManualdePadroesparaIniciacaodoPix.pdf) — official BCB document covering the EMV BR Code QR format.

### Payload structure (TLV — Tag/Length/Value)

Every field is `IIxxVVVV...` where `II` is 2-digit ID, `xx` is 2-digit length, `VVVV` is the value.

| ID | Field | Notes |
|---|---|---|
| 00 | Payload Format Indicator | Fixed value `01` |
| 01 | Point of Initiation Method | `11` static, `12` dynamic |
| 26-51 | Merchant Account Information templates | At least one required; PIX uses `26` with GUI `BR.GOV.BCB.PIX` |
| 26.00 | GUI inside MAI | `BR.GOV.BCB.PIX` |
| 26.01 | PIX key inside MAI | The recipient's key (CPF, CNPJ, email, phone, EVP) |
| 52 | Merchant Category Code | `0000` for unspecified |
| 53 | Transaction Currency | `986` (BRL ISO 4217 numeric) |
| 54 | Transaction Amount | Optional in static, present in dynamic |
| 58 | Country Code | `BR` |
| 59 | Merchant Name | Recipient name |
| 60 | Merchant City | Recipient city |
| 62.05 | Transaction Identifier (txid) | Static: up to 25 chars (free-form ref); Dynamic: up to 35 chars (must be unique per charge) |
| 63 | CRC16 | Computed over entire payload INCLUDING the `6304` prefix |

### CRC16 calculation

- Polynomial: `0x1021` (CRC-16-CCITT)
- Initial value: `0xFFFF`
- Input: the entire payload string up to AND INCLUDING the literal `6304` (the field 63 header)
- Output: 4 uppercase hex digits appended

**Implementation note:** the npm package `crc` exports `crc16ccitt`; cross-validate with at least one known-good payload before shipping. The most common bug is forgetting to include `6304` in the input.

**For SGR v1:** the `payment.method.pix.pixKey` field stores the BCB key only (not the full payload). We build the payload server-side at request time from agency data + amount + txid (use `payment.publicId` as txid for traceability), then feed it to `qrcode.toString()` for SVG output.

Sources: [BCB Manual BR Code](https://www.bcb.gov.br/content/estabilidadefinanceira/spb_docs/ManualBRCode.pdf) · [BCB CRC16 issue #189](https://github.com/bacen/pix-api/issues/189) · [TabNews PIX payload walkthrough](https://www.tabnews.com.br/usrbinenv/entendendo-o-payload-do-pix-copia-e-cola-e-gerando-um-qr-code-estatico)

## 2. FEBRABAN linha digitável (Boleto Bancário)

**Primary spec:** [Layout Padrão de Arrecadação/Recebimento com Utilização do Código de Barras v7 (FEBRABAN, 01/03/2023)](https://cmsarquivos.febraban.org.br/Arquivos/documentos/PDF/Layout%20-%20C%C3%B3digo%20de%20Barras%20-%20Vers%C3%A3o%207%20-%2001_03_2023_mn.pdf)

### Structure — 47 digits, 5 fields

Two parallel encodings:
- **Código de barras:** 44 digits (used by bwip-js with `bcid: "interleaved2of5"`)
- **Linha digitável:** 47 digits (human-readable transform with check digits)

| Field | Positions | Length | Contents |
|---|---|---|---|
| 1 | 1-5 | 5 | Bank code (3) + currency code (1) + free field part 1 (1) |
| 1 | 6-9 | 4 | Free field part 2 (positions 1-4 of free field segment 1) |
| 1 (DV) | 10 | 1 | Verifier digit of field 1 (mod 10) |
| 2 | 11-15 | 5 | Free field part 3 |
| 2 | 16-20 | 5 | Free field part 4 |
| 2 (DV) | 21 | 1 | Verifier digit of field 2 |
| 3 | 22-26 | 5 | Free field part 5 |
| 3 | 27-31 | 5 | Free field part 6 |
| 3 (DV) | 32 | 1 | Verifier digit of field 3 |
| 4 (DV) | 33 | 1 | Overall verifier digit (mod 11) |
| 5 | 34-37 | 4 | Due date factor (days since 07/10/1997, capped) |
| 5 | 38-47 | 10 | Amount in centavos (zero-padded) |

### Display format

Banks render the linha digitável with spaces separating fields:

```
34191.79001 01043.510047 91020.150008 8 87770026000
```

Group lengths: 5.5 5.6 5.6 1 4-10 (the 4-10 split is for due date factor + amount; some banks render as one block, some split).

**For SGR:** display the FEBRABAN-standard grouped form in `Mono`/`tabular-nums`. Strip spaces on copy (clipboard gets unspaced 47-digit string). The bwip-js barcode input is the 44-digit code-de-barras, not the linha digitável.

Sources: [FEBRABAN portal layout page](https://portal.febraban.org.br/pagina/3166/33/pt-br/layour-arrecadacao) · [Iugu docs — boleto fields](https://dev.iugu.com/docs/campos-de-boleto-bancario) · [TTrix anatomia do código de barras](https://www.ttrix.com/apple/iphone/boletoscan/boletoanatomia.html)

## 3. Stellar SEP-7 — payment URI

**Primary spec:** [SEP-0007: URI Scheme to facilitate delegated signing](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0007.md)

### URI format

```
web+stellar:pay?destination=GA3D...X9KQ&amount=10.50&asset_code=USDC&asset_issuer=GA5Z...&memo=01H8XY...&memo_type=MEMO_TEXT
```

### Key parameters for SGR

| Param | Required | Notes |
|---|---|---|
| destination | Yes | Public key of the recipient (G…, 56 chars base32) |
| amount | No | Decimal string; if omitted, wallet prompts user |
| asset_code | When non-native | e.g. `USDC` |
| asset_issuer | When non-native | Issuer's public key |
| memo | Optional | The on-chain memo — use `payment.publicId` |
| memo_type | When memo present | `MEMO_TEXT` (28 bytes max), `MEMO_ID` (uint64), `MEMO_HASH`, `MEMO_RETURN` |
| msg | Optional | Off-chain UI hint (≤300 chars, URL-encoded) — NOT put on chain |

**For SGR:** use `MEMO_TEXT` with `payment.publicId` (truncate to ≤28 bytes if needed — UUIDv4 is 36 chars hex but a 22-char nanoid fits). The memo is the reconciliation key.

### Stellar Expert links

`stellar.expert` is the canonical block explorer:

- Account: `https://stellar.expert/explorer/public/account/{destination}`
- Transaction: `https://stellar.expert/explorer/public/tx/{txHash}`

On the Stellar execution screen, the destination address can link out to its stellar.expert account page (with appropriate `rel="noopener noreferrer"`). On the receipt, the txHash links to the tx page — gives the tenant an independent verification path.

For testnet during development: replace `public` with `testnet` in the URL path.

Sources: [SEP-0007 stellar-protocol](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0007.md) · [Stellar Docs — SEP-7](https://developers.stellar.org/docs/build/apps/wallet/sep7)

## 4. WCAG 2.2 — most relevant criteria for this flow

[Full spec — W3C](https://www.w3.org/TR/WCAG22/)

| SC | Level | Topic | Quick apply |
|---|---|---|---|
| 1.3.1 | A | Info and Relationships | Use semantic HTML — `<button>` not `<div onClick>`, `<code>` for the copia-e-cola |
| 1.4.1 | A | Use of Color | Status = square + label, never color alone |
| 1.4.3 | AA | Contrast (Minimum) | All copy verified ≥4.5:1 against bg |
| 1.4.11 | AA | Non-text Contrast | Focus indicator amber #C47E10 ≥3:1 against white (passes at 5.9:1) |
| 2.1.1 | A | Keyboard | All actions reachable by Tab + Enter |
| 2.1.2 | A | No Keyboard Trap | Countdown must not steal focus |
| 2.4.7 | AA | Focus Visible | Border-color shift to amber, no `outline: none` |
| 2.4.11 | AA | Focus Not Obscured (Min) | Sticky header must not cover focused element |
| 2.4.12 | AAA | Focus Not Obscured (Enhanced) | Aim for AAA on this surface — public, single-purpose |
| 2.5.8 | AA | Target Size (Min) | 24×24 min; brand spec exceeds at 48 |
| 3.2.6 | A | Consistent Help | Agency-contact CTA in same position on every screen |
| 3.3.2 | A | Labels or Instructions | Stellar txHash input needs visible label |
| 3.3.7 | A | Redundant Entry | Tenant never re-enters anything across screens |
| 4.1.2 | A | Name, Role, Value | Copy buttons need accessible name |
| 4.1.3 | AA | Status Messages | Toast `role="status"` + `aria-live="polite"` |

Sources: [W3C WCAG 2.2](https://www.w3.org/TR/WCAG22/) · [TestParty WCAG 2.2 guide](https://testparty.ai/blog/wcag-22-new-success-criteria)

## 5. shadcn/ui components used

Already in the project; reference for primitives:

- **Card / CardHeader / CardContent** — [shadcn/ui card](https://ui.shadcn.com/docs/components/card) — used for method cards, execution panels, receipt
- **Button** — [shadcn/ui button](https://ui.shadcn.com/docs/components/button) — amber CTAs use a custom variant wired to brand tokens; `size="lg"` matches 48px height
- **Skeleton** — [shadcn/ui skeleton](https://ui.shadcn.com/docs/components/skeleton) — QR placeholder, address placeholder
- **Sonner** — [shadcn/ui sonner](https://ui.shadcn.com/docs/components/sonner) — toast surface for copy confirmation

Custom primitives already defined in repo:
- `Mono` — JetBrains Mono + tabular-nums wrapper
- `PaymentStateTag` — square + label badge per brand spec
- `CopyableValue` (new) — Mono + copy button + Sonner toast

## 6. `qrcode` (node-qrcode) — API surface

[npm — qrcode](https://www.npmjs.com/package/qrcode)

Server-side RSC usage:

```ts
import QRCode from "qrcode";

const svg: string = await QRCode.toString(payload, {
  type: "svg",
  errorCorrectionLevel: "M", // M = 15% — enough for PIX strings
  margin: 1,                  // narrow quiet zone (units: modules)
  width: 240,                 // pixel width hint
  color: { dark: "#1A1A1A", light: "#FFFFFF" },
});
```

Returns an `<svg>` string. Pass it to a client component via prop and render with `dangerouslySetInnerHTML` inside a controlled wrapper (or parse and reconstruct as React tree — overkill for this).

For BR PIX strings ~250-300 chars, errorCorrectionLevel "M" works at version 8-10. "L" can fail in poor camera conditions; "H" doubles the size for no real-world gain.

## 7. `bwip-js` — barcode SVG

[npm — @bwip-js/node](https://www.npmjs.com/package/@bwip-js/node)

```ts
import bwipjs from "@bwip-js/node";

const svg: string = bwipjs.toSVG({
  bcid: "interleaved2of5",
  text: barcode44Digits,       // not the linha digitável
  scale: 2,
  height: 12,                  // mm
  includetext: false,
  backgroundcolor: "FFFFFF",
});
```

Returns SVG XML. Same rendering approach as qrcode — RSC builds the SVG string, client component receives it as a prop.

## 8. Next.js 16 — Route Groups, params, error boundaries

- [Route Groups](https://nextjs.org/docs/app/api-reference/file-conventions/route-groups) — parentheses-wrapped directories that group routes without affecting the URL path
- [Async params in Next.js 16](https://nextjs.org/docs/app/getting-started/upgrading) — `params` and `searchParams` are Promises; `await` them
- [error.tsx](https://nextjs.org/docs/app/api-reference/file-conventions/error) — must be `"use client"`, receives `{ error: Error & { digest?: string }, reset: () => void }`
- [not-found.tsx](https://nextjs.org/docs/app/api-reference/file-conventions/not-found) — triggered by `notFound()` from `next/navigation`
- [loading.tsx](https://nextjs.org/docs/app/api-reference/file-conventions/loading) — RSC suspense fallback

## 9. next-intl — dynamic translation keys

- `useTranslations(namespace)` returns a function that accepts a key and optional params
- Dynamic keys via template literals work for closed enums: `t(\`errors.${result.error.code}\`)`
- Missing keys fall back to the key string and emit a console warning in dev — CI lint or a custom check should enforce parity between `pt-BR.json` and `en.json`
- `getTranslations` is the RSC equivalent — call with `await getTranslations({ locale, namespace })`

[next-intl docs](https://next-intl.dev/docs/usage/messages)

## 10. Convex — public query pattern + Result

Public query (no auth):

```ts
import { query } from "../_generated/server";
import { v } from "convex/values";

export const getPublicByPublicId = query({
  args: { publicId: v.string() },
  handler: async (ctx, { publicId }) => {
    // no ctx.auth.getUserIdentity() — public by design
    const payment = await ctx.db
      .query("payments")
      .withIndex("by_publicId", q => q.eq("publicId", publicId))
      .unique();
    if (!payment) return { success: false, error: { code: "NOT_FOUND" } };
    return { success: true, data: shapePublicPayment(payment) };
  },
});
```

The `by_publicId` index must be added to `convex/schema.ts` on the `payments` table.

Result pattern usage and `Result<Success, Error>` typing rules: see `src/lib/result.ts` and the `convex-functional-programming` skill.

[Convex queries docs](https://docs.convex.dev/functions/query-functions)

## Sources (consolidated)

- [BCB — Manual BR Code](https://www.bcb.gov.br/content/estabilidadefinanceira/spb_docs/ManualBRCode.pdf)
- [BCB — Manual de Padrões para Iniciação do Pix v2.9.0](https://www.bcb.gov.br/content/estabilidadefinanceira/pix/Regulamento_Pix/II_ManualdePadroesparaIniciacaodoPix.pdf)
- [FEBRABAN — Layout Padrão Código de Barras v7](https://cmsarquivos.febraban.org.br/Arquivos/documentos/PDF/Layout%20-%20C%C3%B3digo%20de%20Barras%20-%20Vers%C3%A3o%207%20-%2001_03_2023_mn.pdf)
- [SEP-7 Stellar URI Scheme](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0007.md)
- [WCAG 2.2](https://www.w3.org/TR/WCAG22/)
- [shadcn/ui](https://ui.shadcn.com/docs)
- [qrcode npm](https://www.npmjs.com/package/qrcode)
- [bwip-js GitHub](https://github.com/metafloor/bwip-js)
- [Next.js — Route Groups](https://nextjs.org/docs/app/api-reference/file-conventions/route-groups)
- [Convex Next.js docs](https://docs.convex.dev/client/nextjs/app-router/)
