# Stellar payment assets & networks

How the payment flow's asset registry is structured and how to extend it.

> **Disposable testnet treasury wallet** (Mutav recipient, for local dev +
> demos) is documented in [`testnet-wallet.md`](./testnet-wallet.md) — its
> secret key is published in that file by design. **Do not send mainnet
> funds to this address; testnet only.** See the file for the Convex env
> command to wire it, and rotate to a fresh, secret-managed keypair before
> any production traffic.

---

## Files

| File              | Role                                                                                                                                              |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `network.ts`      | `ChainNetwork` type + `getStellarNetwork()` reader (env-driven).                                                                                  |
| `assets.ts`       | `ASSETS` registry, `resolveAsset()`, `getActiveAssets()`. The source of truth for what payable.                                                   |
| `asset-format.ts` | `brlCentsToAsset()` — converts an invoice total from BRL cents into a canonical Stellar amount string using either a live or fallback rate.       |
| `sep7.ts`         | Pure SEP-7 URI builder. Accepts asset code + optional issuer.                                                                                     |
| `price-feed.ts`   | `getBrlRates()` — server-side CoinGecko fetch with Next 30s cache. NaN/undefined for missing pairs; callers fall back to registry's `brlPerUnit`. |

## Data shape

```ts
type ChainNetwork = "stellar-testnet" | "stellar-mainnet"; // extend here for EVM/Solana
type AssetAddress = {
  chain: "stellar"; // discriminator
  network: ChainNetwork;
  issuer: string | null; // null = native (XLM only on Stellar)
  sacContractId?: string; // Soroban SAC, when contract mode lands
};
type Asset = {
  symbol: string; // e.g. "USDC"
  decimals: number; // on-chain precision (Stellar = 7)
  displayDecimals: number; // UI precision (USDC = 2, XLM = 4)
  brlPerUnit: number; // STATIC FALLBACK only — live rate via price-feed.ts
  label: { ptBR: string; en: string };
  addresses: AssetAddress[];
};
```

## Adding a token to an existing chain

Example: add **EURC** (Euro Coin) on Stellar.

1. **Verify the issuer is real and liquid.** Don't trust filenames or community lists alone.

   ```bash
   curl -s 'https://api.stellar.expert/explorer/public/asset?search=EURC&sort=trustlines&order=desc&limit=5' \
     | jq '._embedded.records[] | { asset, trustlines: .trustlines, domain, org: .tomlInfo.orgName }'
   ```

   Trustlines + non-zero `payments` + a real `domain` (verifiable SEP-1 stellar.toml) are the signals. Anything claiming "Bank of England.com.co" with 3 trustlines is fraud — skip.

2. **Get both networks.** A token in production needs `stellar-mainnet`. To enable dev work, get the testnet issuer (Circle / Transfero / etc. publish test issuers — confirm via their docs or repeat the query against `https://api.stellar.expert/explorer/testnet/...`).

3. **Append to `ASSETS` in `assets.ts`:**

   ```ts
   {
     symbol: "EURC",
     decimals: 7,
     displayDecimals: 2,
     brlPerUnit: 5.5,           // fallback; rate-feed will override
     label: { ptBR: "Euro (EURC)", en: "Euro Coin" },
     addresses: [
       { chain: "stellar", network: "stellar-testnet", issuer: "GA…TESTNET" },
       { chain: "stellar", network: "stellar-mainnet", issuer: "GA…MAINNET" },
     ],
   },
   ```

4. **Add the price-feed mapping** in `price-feed.ts`:

   ```ts
   const COINGECKO_ID: Record<string, string> = {
     XLM: "stellar",
     USDC: "usd-coin",
     EURC: "euro-coin", // ← look this up at coingecko.com/en/coins/euro-coin
   };
   ```

   If CoinGecko doesn't list it, the registry fallback (`brlPerUnit`) wins. Document in a comment.

5. **(Optional) update i18n labels** for the asset name shown next to the amount. Today the label comes from `Asset.label`, not i18n, so this is just consistency.

6. **No schema migration needed.** The payment row doesn't store asset preference — the tenant chooses via the tab UI, and every tab uses the same muxed M-address as the destination.

### Quick verification checklist before merging

- [ ] Testnet issuer exists on Stellar Expert (`/explorer/testnet/asset/{CODE}-{ISSUER}`)
- [ ] Mainnet issuer has >100 funded trustlines and non-zero 7d volume
- [ ] CoinGecko `simple/price` returns a `brl` quote
- [ ] `getActiveAssets(getStellarNetwork())` includes the new symbol on both env values
- [ ] Tabs render the new asset, QR encodes the right `asset_issuer`, copy buttons work

## Adding a new chain (EVM, Solana, etc.)

Today the registry is Stellar-only. To go multi-chain:

1. **Extend `ChainNetwork`** in `network.ts`:

   ```ts
   export type ChainNetwork =
     | "stellar-testnet"
     | "stellar-mainnet"
     | "evm-ethereum-mainnet"
     | "evm-base-mainnet"
     | "solana-mainnet";
   ```

2. **Add a new `AssetAddress` variant** in `assets.ts`:

   ```ts
   type EvmAssetAddress = {
     chain: "evm";
     network: ChainNetwork;
     contractAddress: `0x${string}`;
     decimals: number; // EVM decimals (USDC = 6, most others 18)
   };
   type SolanaAssetAddress = {
     chain: "solana";
     network: ChainNetwork;
     mintAddress: string;
   };
   export type AssetAddress = StellarAssetAddress | EvmAssetAddress | SolanaAssetAddress;
   ```

3. **Update `resolveAsset()`** to switch on `chain`:

   ```ts
   const addr = asset.addresses.find((a) => a.network === network);
   // Then return a ResolvedAsset shape with whichever fields apply.
   ```

4. **Add an env reader** for the new chain (e.g. `getEvmNetwork()`), or unify under a single `getActiveChain()` if the dashboard becomes chain-aware.

5. **Add per-chain destination/derivation helpers** — Stellar uses muxed accounts (`muxedAddress.ts`). EVM uses a deterministic CREATE2 address or an ERC-2612 permit + relayer. Each chain gets its own `lib/{chain}/destination.ts`.

6. **Per-chain payment intent URIs.** SEP-7 is Stellar-only. EVM has EIP-681 (`ethereum:0x…?value=…&address=…`). Solana has Solana Pay (`solana:…`). Each chain gets its own URI builder mirroring `sep7.ts`.

7. **Per-chain confirmation poller.** Today `HorizonPaymentPoller` watches Stellar Horizon. EVM watches via JSON-RPC + log filter; Solana watches via WebSocket `accountSubscribe`. Each goes behind a `<PaymentPoller chain={…}>` strategy.

The registry itself shouldn't grow chain-specific branches — keep all the chain logic in `lib/{chain}/` modules and let the registry be a thin index.

## Rates & live pricing

`brlPerUnit` in `assets.ts` is a **static fallback**. The actual rate at render time comes from `getBrlRates()` in `price-feed.ts`, which:

- Reads CoinGecko's free public endpoint
- Caches via Next's data cache (`fetch(url, { next: { revalidate: 30 } })`) — at most one upstream call per region every 30s
- Returns `undefined` for symbols CoinGecko doesn't have or when the request fails
- Callers (`endereco/page.tsx`) substitute `rates[symbol] ?? asset.brlPerUnit`

**v1 limitations:** rate can move between page renders; tenant sees the spot price at render time.

**Roadmap when this becomes a product:**

- **Snapshot at invoice issuance** — add `rateSnapshots: { XLM: 0.234, USDC: 5.04, ts: <ms> }` to the `payments` row. `generateMonthlyPayments` action populates it. Page renders the locked rate. "Refresh quote" mutation re-snapshots when stale.
- **Reflector oracle** — when Mode B (Soroban contract) ships, switch the price source to Reflector (`reflector.network`) so the server and the on-chain contract read the same feed.
- **Provider failover** — wrap `getBrlRates()` to try CoinGecko first, then Reflector, then a Mercado Bitcoin or Binance BRL endpoint, then static fallback.

## Verified live issuers (as of 2026-05-13)

| Symbol | Testnet issuer                                             | Mainnet issuer                                             | Source                                                     |
| ------ | ---------------------------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------------- |
| XLM    | native (no issuer)                                         | native (no issuer)                                         | —                                                          |
| USDC   | `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5` | `GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN` | Stellar Expert: 18,474 / 2,181,403 trustlines respectively |

## Assets investigated but not adopted

- **BRL** (any issuer with code "BRL"): top result has 3 trustlines, 0 payments, suspicious domain. No active BRL stablecoin on Stellar with liquidity.
- **BRZ** (Transfero, `GABMA6FPH3OJXNTGWO7PROF7I5WPQUZOB4BLTBTP4FK6QV7HWISLIEO2`): 82 trustlines, 829,784 lifetime payments, but **zero 7d volume**. Dormant. Listed for historical reference.
- **TESOURO** (Etherfuse, `GCRYUGD5NVARGXT56XEZI5CIFCQETYHAPQQTHO2O3IQZTHDH4LATMYWC`): 164 trustlines, 2,695 payments. Real, yield-bearing, Brazilian-Treasury-backed. Sibling assets from the same issuer: USTRY (596), CETES (783), MEX, CETESZ, EUROB, KTB. Small footprint; revisit if the project needs a yield-bearing BRL representation.
- **BRLA** (BRLA Digital): doesn't exist on Stellar mainnet (Polygon/Ethereum-native).
