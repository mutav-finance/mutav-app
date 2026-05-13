# Content Strategy — Microcopy (pt-BR canonical + en parity)

> Phase: research | Project: payment-flow | Date: 2026-05-13

Voice register: **TGA Garantia** with a light Cuidador overlay. Authoritative calm, precision sem arredondamento, economy of words. The tenant has never seen TGA — copy must be invisible, trustworthy, and never demand reading twice.

## Voice rules (this surface)

- Imperative verbs in CTAs: `Pagar com PIX`, never `Continuar` or `Próximo`
- Specific times and exact amounts: `R$ 2.847,00 às 18h22`, never `R$ 2.847` or `agora`
- One CTA per screen — quiet secondary actions are links, not buttons
- No exclamation marks. No emojis. No celebration on receipt.
- Never refer to TGA as a product on this surface — the tenant pays the imobiliária, the brand is invisible chrome
- pt-BR canonical; en parity from day one (`messages/{locale}.json`)

## Forbidden words on this surface

| Forbidden | Why | Use instead |
|---|---|---|
| blockchain | Tech jargon, scares tenants | (Stellar) "pagamento direto via rede" |
| onchain / on-chain | Same | "registrado na rede" |
| protocolo | Reads as technological | "registro" / "sistema" |
| smart contract | Same | omit; speak of "registro" |
| token / TGA | Brand-as-product not relevant here | omit entirely |
| wallet | English jargon | "carteira" (only on Stellar screen, sparingly) |
| DeFi / yield | Crypto-native | n/a |
| liquidação | Bank-speak | "repasse" |
| transferência | Generic | "pagamento" (specific) |
| pagamento processado com sucesso | Verbose celebration | "Pagamento confirmado" |
| obrigado / parabéns | Celebration | omit |
| ! exclamation | Voice rule | period |

For Stellar specifically: "Stellar" the network name is OK (it's a brand, not jargon). Acceptable phrases: "rede Stellar", "endereço de pagamento", "hash da transação", "rede internacional". Forbidden in this context: any phrase explaining what blockchain is.

## Copy blocks by screen

### Method-picker screen

| Slot | pt-BR | en |
|---|---|---|
| Title | Pagamento de aluguel | Rent payment |
| Subtitle | {agencyName} · Contrato #{publicId} | {agencyName} · Contract #{publicId} |
| Amount | R$ 2.847,00 | R$ 2,847.00 |
| Due | Vence em 3 dias · 15/05/2026 | Due in 3 days · May 15, 2026 |
| Section header | Escolha o método | Choose payment method |
| PIX card label | PIX | PIX |
| PIX speed | Confirmação imediata | Confirmed instantly |
| Boleto card label | Boleto | Boleto |
| Boleto speed | Confirmação em 1-3 dias úteis | Confirmed in 1-3 business days |
| Stellar card label | Stellar | Stellar |
| Stellar speed | Confirmação após registro na rede | Confirmed after network record |
| Agency contact | Dúvidas? Fale com a {agencyName} | Questions? Contact {agencyName} |

The amount uses pt-BR locale formatting (`Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })`). En version keeps currency `BRL` symbol `R$` but switches grouping.

### PIX execution screen

| Slot | pt-BR | en |
|---|---|---|
| Title | Pagar com PIX | Pay with PIX |
| Hero amount | R$ 2.847,00 | R$ 2,847.00 |
| Countdown label | Tempo restante | Time remaining |
| Countdown value | 29:42 (mm:ss) | 29:42 |
| Expiration text | Expira às 18h22 | Expires at 6:22 PM |
| QR title (sr) | Código QR para pagamento Pix | QR code for Pix payment |
| QR desc (sr) | Use a câmera do app do seu banco. Como alternativa, copie o código Pix abaixo. | Use your bank app camera. Or copy the Pix code below. |
| Copia-e-cola label | Código Pix | Pix code |
| Primary CTA | Copiar código Pix | Copy Pix code |
| Toast on copy | Copiado | Copied |
| Toast on copy fail | Não foi possível copiar | Couldn't copy |
| Help disclosure | Como pagar com PIX | How to pay with PIX |
| Back link | Voltar aos métodos | Back to methods |

Countdown formatting: zero-padded `mm:ss`. No "minutos restantes" verbose form. At <2:00 remaining, label color may shift to amber per brand (verify color hierarchy in design phase).

### Boleto execution screen

| Slot | pt-BR | en |
|---|---|---|
| Title | Pagar com Boleto | Pay with Boleto |
| Hero amount | R$ 2.847,00 | R$ 2,847.00 |
| Due date | Vence em 15/05/2026 | Due on May 15, 2026 |
| Linha digitável label | Linha digitável | Digitable line |
| Primary CTA | Copiar linha digitável | Copy digitable line |
| Secondary CTA | Abrir boleto (PDF) | Open boleto (PDF) |
| Confirmation hint | Confirmação em 1-3 dias úteis após pagamento | Confirmed 1-3 business days after payment |
| Help disclosure | Como pagar com Boleto | How to pay with Boleto |

The linha digitável is rendered with FEBRABAN-standard space grouping (5 groups separated by single spaces). Example: `34191.79001 01043.510047 91020.150008 8 87770026000`.

### Stellar execution screen

| Slot | pt-BR | en |
|---|---|---|
| Title | Pagar com Stellar | Pay with Stellar |
| Hero amount | R$ 2.847,00 | R$ 2,847.00 |
| Network hint | Pagamento direto via rede Stellar | Direct payment via Stellar network |
| Destination label | Endereço de pagamento | Destination address |
| Destination value (chunked) | GA3D 4F2X 7Y9Z … MN1P X9KQ | (same — addresses don't translate) |
| Memo label | Identificador (memo) | Identifier (memo) |
| Memo value | {contract.publicId} | {contract.publicId} |
| Memo hint | Cole este identificador no campo "memo" da sua carteira | Paste this identifier in your wallet's "memo" field |
| txHash input label | Hash da transação | Transaction hash |
| txHash input help | 64 caracteres do recibo da sua carteira | 64 characters from your wallet receipt |
| Submit CTA | Registrar pagamento | Submit payment |
| Help disclosure | Como pagar via Stellar | How to pay via Stellar |

The "Como pagar" disclosure for Stellar is the only one that needs a longer copy block — most tenants have not used Stellar:

> 1. Abra sua carteira Stellar.
> 2. Inicie um pagamento de R$ 2.847,00 em USDC para o endereço acima.
> 3. Cole o identificador no campo memo.
> 4. Confirme. Copie o hash da transação do recibo.
> 5. Cole o hash abaixo e clique "Registrar pagamento".

en:
> 1. Open your Stellar wallet.
> 2. Send R$ 2,847.00 in USDC to the address above.
> 3. Paste the identifier in the memo field.
> 4. Confirm. Copy the transaction hash from your receipt.
> 5. Paste the hash below and click "Submit payment".

Note: USDC-on-Stellar specifics depend on protocol decision — v1 may use XLM instead. Update copy when token is fixed.

### Receipt screen

| Slot | pt-BR | en |
|---|---|---|
| Title | Pagamento confirmado | Payment confirmed |
| Confirmation line | R$ 2.847,00 às 18h22 — 13/05/2026 | R$ 2,847.00 at 6:22 PM — May 13, 2026 |
| Method evidence label (PIX) | ID da transação Pix | Pix transaction ID |
| Method evidence label (Boleto) | Linha digitável paga | Digitable line paid |
| Method evidence label (Stellar) | Hash da transação Stellar | Stellar transaction hash |
| Agency contact card title | {agencyName} | {agencyName} |
| Agency contact card subtitle | Em caso de dúvida, entre em contato | If you have questions, get in touch |

Status badge above the title: square `#2E8B5A` + label "PAGO" / "PAID". The 4px green top-edge stripe on the Card is the only decorative success-green in the entire flow.

No "obrigado", no checkmark icon, no confetti. Confirmation without celebration.

### Expired / canceled / error screens

| State | pt-BR title | pt-BR body | en title | en body |
|---|---|---|---|---|
| overdue | Pagamento expirado | Este pagamento venceu em 15/05/2026. Entre em contato com a {agencyName} para gerar um novo. | Payment expired | This payment expired on May 15, 2026. Contact {agencyName} for a new one. |
| canceled | Pagamento cancelado | Este pagamento foi cancelado pela imobiliária. | Payment canceled | This payment was canceled by the agency. |
| error (load) | Não conseguimos carregar este pagamento | Tente novamente em alguns instantes. Se o problema persistir, fale com a {agencyName}. | We couldn't load this payment | Try again in a moment. If the problem persists, contact {agencyName}. |
| error (submit Stellar) | Hash inválido | Verifique o hash da transação no recibo da sua carteira e tente novamente. | Invalid hash | Check the transaction hash in your wallet receipt and try again. |
| not-found | Pagamento não encontrado | O link pode estar incorreto. Verifique com a {agencyName}. | Payment not found | The link may be incorrect. Check with {agencyName}. |

Primary CTA on all error states: `Fale com a {agencyName}` (link to agency contact). Never "Tentar novamente" alone — always with an escape hatch.

## Toast catalog

Single namespace `payment.toasts.*`:

| Key | pt-BR | en |
|---|---|---|
| copied | Copiado | Copied |
| copyFailed | Não foi possível copiar | Couldn't copy |
| methodChosen | Método selecionado | Method selected |
| stellarSubmitted | Pagamento registrado. Aguarde a confirmação. | Payment submitted. Awaiting confirmation. |
| networkError | Sem conexão. Tente novamente. | No connection. Try again. |

## Number & date formatting

- Currency: `Intl.NumberFormat(locale, { style: "currency", currency: "BRL" })` — pt-BR → "R$ 2.847,00", en → "R$ 2,847.00"
- Date: `Intl.DateTimeFormat(locale, { dateStyle: "long" })` — pt-BR → "15 de maio de 2026", en → "May 15, 2026"
- Time: `Intl.DateTimeFormat(locale, { timeStyle: "short" })` — pt-BR → "18:22", en → "6:22 PM"
- Receipt joins date+time: "às 18h22 — 13/05/2026" (note: `às {time}h{minutes}` is the pt-BR canonical receipt form, not the Intl default)

## Microcopy anti-patterns (forbidden)

- "Ficamos felizes em informar que seu pagamento foi processado com sucesso!" (verbose celebration)
- "Detectamos uma situação em seu contrato que requer atenção." (corporate hedge)
- "Pagamento pendente" alone (no specifics)
- "Erro ao processar pagamento" (no recovery path)
- "Clique aqui" (no context)
- "Por favor" / "Please" in CTAs (over-polite, weak imperative)

## Sources

- TGA Brand voice contract — `../brand/` (sibling repo)
- [WCAG 2.2 — 3.3.2 Labels or Instructions](https://www.w3.org/TR/WCAG22/#labels-or-instructions)
- [GOV.UK Service Manual — Writing for the web](https://www.gov.uk/service-manual/design)
- [Nielsen Norman — Microcopy guidelines](https://www.nngroup.com/articles/microcontent-how-to-write-headlines-page-titles-and-subject-lines/)
