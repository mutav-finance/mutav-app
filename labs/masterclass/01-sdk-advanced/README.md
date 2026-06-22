# Bloco 1 — SDK Stellar avançado

The three patterns that turn Stellar from "send money on-chain" into a UX that doesn't make users learn the word "blockchain".

## Setup

```sh
cd labs/masterclass
bun install
cp .env.example .env
bun run keypair          # generate MASTER_SECRET, paste into .env
# optional: run again for SPONSOR_SECRET
```

`MASTER_SECRET` is mandatory. `SPONSOR_SECRET` is optional — if absent, the master account plays both roles (still demonstrates the mechanics).

For lab 4 you'll also need testnet USDC on the master account. Get it from Circle's faucet:

```
https://faucet.circle.com → Stellar Testnet → <master public key>
```

## Scripts

| #   | Script                           | Pattern            | What it proves                                                                                                   |
| --- | -------------------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------- |
| 1   | `01-multi-op.ts`                 | Multi-operation tx | 3 ops (create account, trustline, payment) execute atomically — all succeed or none do.                          |
| 2   | `02-fee-bump.ts`                 | Fee bump           | A user with USDC but no XLM can transact because the sponsor wraps their inner tx and pays the fee.              |
| 3   | `03-sponsored-trustlines.ts`     | Sponsored reserves | The user account exists with 0 XLM because the sponsor holds the 1 XLM base reserve + 0.5 XLM trustline reserve. |
| 4   | `04-zero-friction-onboarding.ts` | All three combined | New user is onboarded, receives 10 USDC, and sends 1 USDC back — all without ever holding XLM.                   |

Run any of them:

```sh
bun run 1:multi-op
bun run 1:fee-bump
bun run 1:sponsored
bun run 1:zero-friction
```

## Pitfalls (slide 10)

| Pitfall              | Symptom                               | Where to look                                                                  |
| -------------------- | ------------------------------------- | ------------------------------------------------------------------------------ |
| Forgotten timebounds | tx hangs in mempool, eventually drops | `setTimeout(180)` on every `TransactionBuilder`                                |
| Memo in Soroban      | tx rejected                           | Memos are classic-only — bloco 2 covers the workaround                         |
| Stale sequence       | `tx_bad_seq`                          | `horizon.loadAccount()` immediately before building                            |
| Wrong fee            | `tx_insufficient_fee`                 | `BASE_FEE * op_count` for inner txs, `BASE_FEE * (op_count + 1)` for fee bumps |

## Mental model

- **Multi-op** = atomicity + economy (1 fee instead of N).
- **Sponsored reserves** = another account pays the per-entry XLM lockup (account base, trustlines, signers, offers, data entries).
- **Fee bump** = another account pays the per-tx XLM fee.

The three are orthogonal. Combine them when you want a user who never sees XLM.

## What's next

Bloco 2 — connect this stack to real fiat via Etherfuse (BRL via Pix → TESOURO on Stellar testnet).
