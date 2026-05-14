# Mutav treasury — Stellar testnet wallet

> ⚠️ **DISPOSABLE TESTNET WALLET — DO NOT SEND MAINNET FUNDS.**
>
> - The secret key below **is published in this public-by-default repository**. Anyone with read access to the repo, the git history, or this Markdown file controls the account. Treat it as fully compromised by design.
> - **Any real-asset transfer (Stellar mainnet XLM, USDC, BRZ, anything with economic value) sent to this address is irrecoverable** — anyone watching the repo can sweep it instantly.
> - **Network: Stellar testnet only.** Testnet XLM is minted on demand by friendbot and has zero economic value. If you find yourself about to flip the network selector to "public" while this account is configured — stop.
> - This wallet exists purely so any developer can `git clone`, `convex env set`, and reproduce the payment flow against a known funded address. It is a scaffold; replace it before any production traffic.
>
> **For production:** generate a fresh keypair on a trusted machine, store the
> secret only in a real secret manager (Convex production env, 1Password, etc.),
> never commit it, and rotate it on a documented schedule.

## Keypair (DISPOSABLE — testnet only)

| Field               | Value                                                                                                                                |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| **Status**          | 🧪 **Disposable / public-by-design.** Anyone reading the repo controls this account.                                                 |
| **Network**         | Stellar **testnet** (`https://horizon-testnet.stellar.org`) — **never** point this account at Stellar public mainnet.                |
| **Public (G)**      | `GD7ZCGE3Z2KV7STAWXLTKZQP7IYZ2SSJ6VNOQ2CHK4YWRSLIYUECMNWV`                                                                           |
| **Secret (S)**      | `SBDW2AG65ZSTXYTVIAGJGU7VOKBBQNNVN4KHCL5XAT65USJKYCQ72FW6` ← **published; assume already compromised**                               |
| **Funded by**       | `https://friendbot.stellar.org` on 2026-05-13                                                                                        |
| **Initial balance** | 10,000.0000000 XLM (testnet, zero economic value)                                                                                    |
| **Trustlines**      | `USDC` — `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5` (Circle testnet, established 2026-05-13, tx `6f2602af6ba43691…`) |

Explorer: <https://stellar.expert/explorer/testnet/account/GD7ZCGE3Z2KV7STAWXLTKZQP7IYZ2SSJ6VNOQ2CHK4YWRSLIYUECMNWV>

## What it's used for

- `convex/lib/env.ts → getMutavSourceAccount()` returns this G-address when
  `STELLAR_MUTAV_SOURCE_ACCOUNT` is set on Convex dev deployments.
- `convex/payments/lib/muxedAddress.ts → derivePaymentMuxedAddress()` builds
  per-invoice `M…` destinations from this G + the random `muxedId` stored
  on each `payments` row.
- The SEP-7 QR + `CopyableAddress` block on `/pagar/[publicId]/endereco`
  render the muxed `M…` so any Stellar wallet can scan or paste.

## Setup on a fresh dev environment

```bash
bunx convex env set STELLAR_MUTAV_SOURCE_ACCOUNT \
  GD7ZCGE3Z2KV7STAWXLTKZQP7IYZ2SSJ6VNOQ2CHK4YWRSLIYUECMNWV
```

After setting, restart `bun run dev` so the Convex query picks up the new env.

## Re-funding (testnet XLM only)

Friendbot grants 10,000 XLM per request; the account can re-request when
balance drops:

```bash
curl -s "https://friendbot.stellar.org/?addr=GD7ZCGE3Z2KV7STAWXLTKZQP7IYZ2SSJ6VNOQ2CHK4YWRSLIYUECMNWV"
```

## Funding USDC

The USDC trustline is already established (see Trustlines row above) so
the account can receive testnet USDC. Mint some via Circle's faucet:

- <https://faucet.circle.com/> — pick **Stellar testnet**, paste the
  public G-address, complete hCaptcha. Faucet drops 10 USDC per request.

If the trustline ever gets removed (e.g. recreated wallet) re-add via the
Stellar Lab "Change Trust" operation (`USDC` / Circle testnet issuer
`GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5`) before hitting
the faucet — otherwise faucet errors with "trustline entry is missing".

Reference: see `reference_stellar_testnet_usdc.md` in personal memory for
the trustline-before-faucet gotcha.

## End-to-end manual test (XLM, today)

1. Reload `/pt-BR/pagar/PAY-2026-05-0100` — the QR + address point at this
   wallet's per-payment muxed surface.
2. Open a second wallet (e.g. import `SBDW2AG6…` into Lobstr in testnet
   mode, or use the Stellar Lab) and send the exact XLM amount shown to
   the displayed `M…` address.
3. Verify the inbound payment on the explorer:
   <https://stellar.expert/explorer/testnet/account/GD7ZCGE3Z2KV7STAWXLTKZQP7IYZ2SSJ6VNOQ2CHK4YWRSLIYUECMNWV>
   — the destination `account_muxed` should decode to the same `muxedId`
   stored on the `payments` row.
4. (Until the Horizon polling action lands — see `BUILD-LOG.md` known gap
   #1) Manually mark the payment paid via Convex dashboard or
   `setPaymentMethod` mutation.

## Production

Generate a separate keypair, store the secret in Convex production env
(`bunx convex env set --prod STELLAR_MUTAV_SOURCE_ACCOUNT …`), and rotate
it on a documented schedule. Never reuse this testnet keypair on mainnet.
