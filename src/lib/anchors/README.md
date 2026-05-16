# Stellar Anchor Integration Library

Framework-agnostic TypeScript library for integrating Stellar anchors. Two layers:

1. **`sep/`** — composable [SEP](https://github.com/stellar/stellar-protocol/tree/master/ecosystem) protocol modules (`sep1`, `sep6`, `sep10`, `sep12`, `sep24`, `sep31`, `sep38`). Use these to talk to any SEP-compliant anchor.
2. **`types.ts`** — a shared `Anchor` interface that provider-specific clients implement. Use this when an anchor exposes its own API instead of the SEPs.

A reference SEP client lives at `testanchor/`, wired against `testanchor.stellar.org`. Copy that directory as the starting point for a new SEP-compliant client.

For protocol-level background — what an anchor is, which SEPs Mutav uses, and how a Pix on-ramp flows — see [`/docs/stellar-anchors.md`](../../../docs/stellar-anchors.md).

## When to use which layer

- **SEP-compliant anchor** (recommended path) → use `sep/` directly, or compose a stateful client like `testanchor/client.ts`.
- **Provider with a proprietary API** → write a client under `src/lib/anchors/<provider>/` that implements `Anchor` from `types.ts`. The interface keeps the rest of the app rail-agnostic.

## The `Anchor` interface

Every non-SEP provider client implements this shape (defined in `types.ts`):

```typescript
interface Anchor {
  readonly name: string;
  readonly displayName: string;
  readonly capabilities: AnchorCapabilities;
  readonly supportedTokens: readonly TokenInfo[];
  readonly supportedCurrencies: readonly string[];
  readonly supportedRails: readonly string[];

  createCustomer(input: CreateCustomerInput): Promise<Customer>;
  getCustomer(input: GetCustomerInput): Promise<Customer | null>;

  getQuote(input: GetQuoteInput): Promise<Quote>;

  createOnRamp(input: CreateOnRampInput): Promise<OnRampTransaction>;
  getOnRampTransaction(transactionId: string): Promise<OnRampTransaction | null>;

  registerFiatAccount(input: RegisterFiatAccountInput): Promise<RegisteredFiatAccount>;
  getFiatAccounts(customerId: string): Promise<SavedFiatAccount[]>;
  createOffRamp(input: CreateOffRampInput): Promise<OffRampTransaction>;
  getOffRampTransaction(transactionId: string): Promise<OffRampTransaction | null>;

  getKycUrl?(customerId: string, publicKey?: string, bankAccountId?: string): Promise<string>;
  getKycStatus(customerId: string, publicKey?: string): Promise<KycStatus>;
}
```

Each client declares its own `supportedTokens` (with Stellar issuers), `supportedCurrencies` (ISO codes), and `supportedRails` (rail identifiers like `pix`, `spei`). No external registry required.

## Quick start: SEP-compliant anchor

```typescript
import { sep1, sep10, sep24 } from "@/lib/anchors/sep";

// 1. Discover endpoints
const toml = await sep1.fetchStellarToml("testanchor.stellar.org");
const authEndpoint = sep1.getSep10Endpoint(toml)!;
const sep24Server = sep1.getSep24Endpoint(toml)!;

// 2. Authenticate
const token = await sep10.authenticate(
  {
    authEndpoint,
    serverSigningKey: toml.SIGNING_KEY!,
    networkPassphrase: "Test SDF Network ; September 2015",
    homeDomain: "testanchor.stellar.org",
  },
  userPublicKey,
  async (xdr, passphrase) => signWithWallet(xdr, passphrase),
);

// 3. Start interactive deposit (anchor renders its own Pix/SPEI/ACH UI)
const response = await sep24.deposit(sep24Server, token, {
  asset_code: "USDC",
  amount: "100",
});

// 4. Hand the user off, then poll until settled
window.open(response.url, "_blank");
const tx = await sep24.pollTransaction(sep24Server, token, response.id);
```

Or use the composed reference client to skip the wiring:

```typescript
import { createTestAnchorClient } from "@/lib/anchors/testanchor";

const client = createTestAnchorClient();
await client.initialize();
await client.authenticate(userPublicKey, signerFn);
const deposit = await client.sep24.deposit({ asset_code: "USDC", amount: "100" });
```

## Implementing a new (non-SEP) anchor

Create `src/lib/anchors/<provider>/client.ts` and implement `Anchor`:

```typescript
import type {
  Anchor,
  AnchorCapabilities,
  TokenInfo,
  Customer,
  CreateCustomerInput,
  // ...
} from "@/lib/anchors/types";
import { AnchorError } from "@/lib/anchors/types";

export class MyAnchorClient implements Anchor {
  readonly name = "myanchor";
  readonly displayName = "My Anchor";
  readonly capabilities: AnchorCapabilities = {
    kycUrl: true,
    kycFlow: "iframe", // 'form' | 'iframe' | 'redirect'
    sandbox: true,
  };
  readonly supportedTokens: readonly TokenInfo[] = [
    {
      symbol: "USDC",
      name: "USD Coin",
      issuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
      description: "A fully-reserved stablecoin pegged 1:1 to the US Dollar",
    },
  ];
  readonly supportedCurrencies: readonly string[] = ["BRL"];
  readonly supportedRails: readonly string[] = ["pix"];

  constructor(private config: { apiKey: string; baseUrl: string }) {}

  async createCustomer(input: CreateCustomerInput): Promise<Customer> {
    const response = await fetch(`${this.config.baseUrl}/customers`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email: input.email }),
    });

    if (!response.ok) {
      throw new AnchorError("Failed to create customer", "CREATE_FAILED", response.status);
    }

    return this.mapToCustomer(await response.json());
  }

  // ... implement the rest of the Anchor methods
}
```

## SEP module reference

Each module is a namespaced import. See [`sep/README.md`](sep/README.md) for the full API.

```typescript
import { sep1, sep10, sep12, sep6, sep24, sep31, sep38 } from "@/lib/anchors/sep";

sep1.fetchStellarToml(domain);
sep10.authenticate(config, publicKey, signerFn);
sep12.getCustomer(kycServer, token, { type: "sep6-deposit" });
sep6.deposit(server, token, { asset_code: "USDC", account, amount });
sep24.deposit(server, token, { asset_code: "USDC" });
sep31.postTransaction(server, token, { amount, asset_code, sender_id, receiver_id });
sep38.getPrice(quoteServer, { sell_asset, buy_asset, sell_amount, context });
```

All async SEP functions accept an optional `fetchFn` as the last argument for SSR compatibility.

## Common types

```typescript
type KycStatus = "pending" | "approved" | "rejected" | "not_started" | "update_required";

type TransactionStatus =
  | "pending"
  | "processing"
  | "completed"
  | "failed"
  | "expired"
  | "cancelled"
  | "refunded";
```

## Error handling

Non-SEP clients throw `AnchorError`:

```typescript
import { AnchorError } from '@/lib/anchors/types';

try {
  await anchor.createOnRamp({ ... });
} catch (error) {
  if (error instanceof AnchorError) {
    console.error(error.code, error.statusCode, error.message);
  }
}
```

## CORS

Browser → anchor API calls typically fail under CORS. Two ways out:

1. **Server proxy** (recommended) — route anchor calls through a Convex action or a Next.js route handler.
2. **Server-only** — keep the SEP client behind the Convex `'use node'` boundary.

## Dependency

```bash
bun add @stellar/stellar-sdk
```

The library has no other runtime dependencies.
