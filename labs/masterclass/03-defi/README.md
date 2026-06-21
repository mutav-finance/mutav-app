# Bloco 3 — DeFi surface (Soroswap · Blend · DeFindex)

Exploration scaffold for the three Stellar DeFi protocols. For Mutav, the on-ramp (Bloco 2) is the immediate priority — this folder is **future-facing**: scripts that document the integration path and surface the API for when we need to expand.

## What each protocol does (per slide 31)

| Protocol | Role  | What you'd call it for                                                                       |
| -------- | ----- | -------------------------------------------------------------------------------------------- |
| Soroswap | Swap  | Trade asset A for asset B (e.g. TESOURO → USDC after on-ramp)                                |
| Blend    | Lend  | Supply USDC to earn yield; borrow against collateral                                         |
| DeFindex | Yield | Wrap a strategy (Blend + Soroswap + ...) in a `deposit/withdraw/totalAssets` vault interface |

The masterclass MVP flow (slide 36): `BRL → Pix → Etherfuse → TESOURO → (rendendo) → Soroswap → USDC → DeFindex → Soroswap → XLM → payment`.

## Reality check (testnet)

| Protocol | Testnet status                                                                                                      | Setup needed                                                                                                        |
| -------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Soroswap | **Mainnet-only** — `/health` reports `testnet:[]`. Aggregator doesn't index testnet liquidity.                      | Free API key at https://api.soroswap.finance/register; quote calls work but only return real routes on mainnet.     |
| Blend    | Soroban contracts deployed on testnet, but the SDK is the only access path (no REST). Need a specific pool address. | `bun add @blend-capital/blend-sdk` + a testnet pool address from docs.blend.capital. Not wired here.                |
| DeFindex | REST API exists; requires authenticated key. Vault contracts on both networks.                                      | Free API key at https://api.defindex.io/register; specific vault address to query (browse https://app.defindex.io). |

## Scripts

```sh
bun run 3:soroswap   # POST /quote — needs SOROSWAP_API_KEY in .env
bun run 3:blend      # docs stub — see comments in 02-blend-pools.ts
bun run 3:defindex   # GET vault balance + apy — needs DEFINDEX_API_KEY + DEFINDEX_VAULT_ADDRESS
```

Each script exits gracefully with a `register at …` message if the relevant key/address is missing — you don't get to a runtime failure for missing credentials.

## When to wire these up for real

The on-ramp lands TESOURO in the user's wallet (Bloco 2). TESOURO yields ~CDI on its own (slide 13), so for the **rental guarantee** use case, additional DeFi steps may be unnecessary — the user holds TESOURO, it rendes, withdrawal triggers an off-ramp back to BRL via Pix.

The DeFi protocols become relevant if/when:

- We want to **convert** TESOURO to USDC (or vice-versa) on-chain → Soroswap.
- We want to **lend** the USDC float (e.g. tied-up commission reserves) for yield → Blend or DeFindex vault.
- We want **packaged yield** without managing rebalances → DeFindex.

Until then, these scripts stay as stubs.
