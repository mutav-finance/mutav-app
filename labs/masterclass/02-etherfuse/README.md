# Bloco 2 — Etherfuse anchor

BRL → TESOURO via Pix (on-ramp) and USDC → BRL via classic Stellar payment with memo hash (off-ramp), against the Etherfuse sandbox at `api.sand.etherfuse.com`.

## Prerequisites

1. **API key** in `labs/masterclass/.env` as `ETHERFUSE_API_KEY=api_sand:…` (generate at <https://devnet.etherfuse.com> → Ramp → API Keys).
2. **A wallet** — auto-generated and persisted to `.data/etherfuse-wallet.json` on first `2:customer` run. Do **not** reuse the shared dev treasury here; Etherfuse enforces one customer per Stellar address globally, and the shared treasury is already claimed by other orgs (slide 28 pitfall #2).

## Run order

```sh
cd labs/masterclass

# One-time setup
bun run 2:smoke          # confirms API key works (GET /ramp/assets)
bun run 2:customer       # generates UUIDs, registers wallet, returns hosted onboarding URL
# → open URL, complete fake KYC, add a "pix" bank, save
bun run 2:finalize       # POST /ramp/customer/{id}/kyc (auto-approves in sandbox) + accept terms

# On-ramp (BRL → TESOURO)
bun run 2:onramp         # opens TESOURO trustline if missing, then quote + order

# Track any order
bun run 2:poll <orderId>

# Off-ramp (USDC → BRL) — needs USDC in the lab wallet first
# Top up via Circle faucet: https://faucet.circle.com → Stellar Testnet → <lab wallet address>
# (Lab wallet is the one printed by 2:customer; it lives in .data/etherfuse-wallet.json)
bun run 2:offramp
```

## Helpers

```sh
bun run 2:renew-url      # presigned onboarding URLs expire in 15 min; regenerate without losing state
```

## What the masterclass didn't tell you

| Gap                                                            | Reality                                                                                                                                                                                                                                         |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Slide 18 says "POST /customers"                                | Real path is `POST /ramp/onboarding-url`. `customerId` + `bankAccountId` are **client-generated UUIDs** that get registered when the user completes hosted onboarding. There is no separate "create customer" endpoint.                         |
| Slide skipped KYC submission                                   | Hosted onboarding alone leaves the wallet at `kycStatus: proposed`. You must `POST /ramp/customer/{id}/kyc` (sandbox auto-approves) before orders work — otherwise `400: Terms and conditions have not been completed for the selected wallet`. |
| KYC payload requires nested `id` fields                        | Top-level `id`, plus `identity.id`, `identity.address.id`, and `id` on each `idNumbers[]` entry. Otherwise the API errors `missing field 'id' at column N`.                                                                                     |
| Slide says "memo TEXT contendo o order_id" for off-ramp        | Real `withdrawMemoType` is `"hash"` (base64-encoded 32-byte buffer), not TEXT. Use `Memo.hash(Buffer.from(withdrawMemo, "base64"))`.                                                                                                            |
| Slide says "POST /ramp/order/{id}/fiat_received" simulates Pix | Not in the public docs. In sandbox, orders sit at `status: created` until manual progression via the dashboard. We use `2:poll` for state visibility instead.                                                                                   |
| Slide says "include `quoteId` in /ramp/quote body"             | Correct — it's a **client-generated idempotency key**, not server-returned. Same pattern for `orderId`.                                                                                                                                         |

## Pitfalls (slide 28, with our additions)

| Pitfall                                           | Symptom                                                           | Fix                                                                                      |
| ------------------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Reusing a Stellar address across orgs             | 409 "You have already added user with this address, see org: …"   | Generate a fresh keypair (we do this automatically in `2:customer`)                      |
| Missing trustline for target asset                | 400 "Your wallet does not have a trustline for X"                 | `2:onramp` auto-opens TESOURO; for other assets, `Operation.changeTrust` before ordering |
| Expired presigned URL                             | 400 "URL has expired"                                             | `bun run 2:renew-url` (keeps same UUIDs)                                                 |
| Reading the wrong customer in a multi-account org | Order errors are mute on this                                     | Always use the same `customerId` from `.data/etherfuse-customer.json`                    |
| Forgetting memo hash on off-ramp                  | Payment lands but order stays orphaned forever                    | `2:offramp` does this correctly — copy that pattern in production                        |
| Polling immediately after order create            | `GET /ramp/order/{id}` may 404 for a few seconds (indexing delay) | `2:poll` retries on error                                                                |

## End-to-end states observed

```
Sandbox on-ramp flow (verified 2026-05-17):
  Quote   100 BRL → 86.63 TESOURO  rate 0.866  fee 0.20 BRL
  Order   created  (waits for Pix payment — no auto-progression in sandbox)
```

## Webhook (scripts 06 + 06b)

Etherfuse pushes events to a URL you register. Local development needs ngrok (or any HTTPS tunnel) because Etherfuse won't post to `localhost`.

```sh
# Terminal A
ngrok http 3000
# copy the https forwarding URL, e.g. https://abc123.ngrok-free.app

# Terminal B (one-time per ngrok URL)
bun run 2:webhook:register https://abc123.ngrok-free.app

# Terminal C (long-running)
bun run 2:webhook
# events land in .data/etherfuse-webhook-events.jsonl
```

The server verifies signatures per [docs.etherfuse.com/guides/verifying-webhooks](https://docs.etherfuse.com/guides/verifying-webhooks): `X-Signature: sha256=<hex>` is HMAC-SHA256 over the **canonicalized JSON** (RFC 8785 JCS), using the base64-decoded `secret` returned once at webhook creation. We dedupe by event `id` so duplicate deliveries don't double-process.

## What's next

Bloco 3 — DeFi (Soroswap, Blend, DeFindex) — once the TESOURO lands in the wallet (or sandbox simulates a fill), we can swap it for USDC, lend USDC on Blend, or wrap it in a DeFindex vault.
