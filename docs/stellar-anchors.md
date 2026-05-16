# Stellar Anchors — The Standard

> An anchor is the bridge between fiat money and a Stellar-issued token. Mutav uses anchors to move BRL between a renter's bank account and the stablecoin balance backing a guarantee.

## What an anchor is

An **anchor** is a regulated business that issues a 1:1-backed asset on Stellar (typically a stablecoin like USDC, BRL-pegged tokens, or a yield-bearing token like CETES) and operates the **on-ramp** (fiat → token) and **off-ramp** (token → fiat) for that asset.

For Mutav, the anchor is the counterparty that:

1. Receives a renter's BRL via Pix.
2. Issues (or releases) the equivalent token amount onto the protocol's Stellar account.
3. On redemption, burns the token and sends BRL back via Pix to the registered account.

The protocol holds the token; the anchor holds the fiat reserves. Mutav never touches BRL directly — that is the anchor's regulated surface.

## The standards (SEPs)

Anchors implement a set of [Stellar Ecosystem Proposals](https://github.com/stellar/stellar-protocol/tree/master/ecosystem) (SEPs) so that any wallet or app can integrate with any anchor through one protocol. Mutav uses the following:

| SEP                                           | Purpose                         | Used for                                                                        |
| --------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------- |
| [SEP-1](https://stellar.org/protocol/sep-1)   | `stellar.toml` discovery        | Find an anchor's endpoints, signing key, and supported assets                   |
| [SEP-10](https://stellar.org/protocol/sep-10) | Web authentication              | Obtain a JWT by signing a challenge transaction with the protocol's Stellar key |
| [SEP-12](https://stellar.org/protocol/sep-12) | KYC/customer management         | Submit and query a renter's verification data                                   |
| [SEP-6](https://stellar.org/protocol/sep-6)   | Programmatic deposit/withdrawal | Initiate transfers without a hosted UI — backend-to-backend                     |
| [SEP-24](https://stellar.org/protocol/sep-24) | Interactive deposit/withdrawal  | Hand the renter off to the anchor's hosted Pix flow, then poll for completion   |
| [SEP-31](https://stellar.org/protocol/sep-31) | Cross-border payments           | Future — send BRL out to a foreign rail via an anchor                           |
| [SEP-38](https://stellar.org/protocol/sep-38) | Anchor RFQ (quotes)             | Get indicative or firm BRL ↔ token quotes before committing to a transfer       |

All of these run over HTTPS. The anchor publishes its support matrix in `stellar.toml`; the client (this repo) discovers what's available and composes the flow.

## How a flow looks

A Pix on-ramp using SEP-24 — the simplest path for renters paying rent in BRL:

```
1. Renter clicks "Pay with Pix" in Mutav
2. Mutav fetches anchor stellar.toml                          (SEP-1)
3. Mutav authenticates with the anchor                        (SEP-10)
4. Mutav submits renter KYC if needed                         (SEP-12)
5. Mutav calls SEP-24 deposit → anchor returns a hosted URL   (SEP-24)
6. Renter sees a Pix QR code on the anchor's page, pays
7. Mutav polls the deposit transaction status                 (SEP-24)
8. On `completed`, the token is on the protocol's Stellar account
```

For backend-to-backend flows (no hosted UI), SEP-6 replaces step 5 with a direct API call that returns Pix payment instructions for Mutav to render itself.

## Regional rails

The same SEPs work for any local payment rail — the rail is the anchor's responsibility, not the protocol's:

| Region | Rail | Token examples   |
| ------ | ---- | ---------------- |
| Brazil | Pix  | USDC, BRL-pegged |
| Mexico | SPEI | USDC, CETES      |
| US     | ACH  | USDC             |
| EU     | SEPA | EURC             |

A "regional starter pack" in this repo means: the SEP protocol library plus the shared `Anchor` interface, so wiring up a new regional anchor only requires implementing one interface or pointing the SEP client at a different `stellar.toml`.

## Where this lives in the repo

| Path                          | Purpose                                                                                      |
| ----------------------------- | -------------------------------------------------------------------------------------------- |
| `src/lib/anchors/types.ts`    | Shared `Anchor` interface that every provider client implements                              |
| `src/lib/anchors/sep/`        | Framework-agnostic SEP modules (`sep1`, `sep6`, `sep10`, `sep12`, `sep24`, `sep31`, `sep38`) |
| `src/lib/anchors/testanchor/` | Reference client composing the SEP modules against `testanchor.stellar.org`                  |
| `src/lib/anchors/sandbox.ts`  | Pre-filled KYC and bank-account fixtures for sandbox environments                            |

Provider-specific clients (Etherfuse for SPEI, future Brazilian providers for Pix) live in their own subdirectories under `src/lib/anchors/` and implement the `Anchor` interface. None ship on this branch — this branch is the foundation only.

## References

- [Learn About Anchors — Stellar Docs](https://developers.stellar.org/docs/learn/fundamentals/anchors)
- [Anchor Platform — official SDF reference implementation](https://developers.stellar.org/docs/platforms/anchor-platform)
- [Stellar Anchor Directory — live list of operating anchors](https://anchors.stellar.org/)
- [SEPs index — full list of ecosystem proposals](https://github.com/stellar/stellar-protocol/tree/master/ecosystem)
