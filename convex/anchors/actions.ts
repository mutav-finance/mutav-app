"use node";

import { v } from "convex/values";

import { internalAction } from "../_generated/server";
import { internal } from "../_generated/api";
import {
  createAnchorClient,
  getAnchorProvider,
  STELLAR_NETWORK_PASSPHRASES,
} from "../../src/lib/anchors/registry";
import { anchorProviderValidator, type AnchorProvider } from "./domain";

/**
 * Per SEP-1 §Currency, anchors may declare `status: "live" | "dead" | "test" | "private"`.
 * Mutav surfaces only currencies an integrator should actually use:
 *   - "live"  → usable in production
 *   - "test"  → usable when the provider is a sandbox (the registry entry says so)
 *   - "dead"  → deprecated, never offer
 *   - "private" → not for public use, never offer
 *   - undefined → treat as "live" (SEP-1 default)
 */
type CurrencyStatus = "live" | "dead" | "test" | "private";

const ALLOWED_STATUSES_PROD: ReadonlyArray<CurrencyStatus | undefined> = ["live", undefined];
const ALLOWED_STATUSES_SANDBOX: ReadonlyArray<CurrencyStatus | undefined> = [
  "live",
  "test",
  undefined,
];

interface AnchorCurrency {
  /** Asset code as declared in stellar.toml, normalized: "native" → "XLM". */
  code: string;
  /** Issuer G-address, omitted for native XLM. */
  issuer?: string;
  /** Pre-formatted SEP-38 asset identifier — drops the need for callers to reconstruct. */
  sep38Id: string;
  /** SEP-1 currency status; defaults to "live" when the anchor omits it. */
  status: CurrencyStatus;
}

interface AnchorCapabilities {
  provider: AnchorProvider;
  network: "testnet" | "pubnet";
  networkPassphrase: string;
  /** SIGNING_KEY from the anchor's stellar.toml — pin per-agency to defend against future toml tampering. */
  signingKey: string | null;
  currencies: AnchorCurrency[];
  supports: {
    sep6: boolean;
    sep10: boolean;
    sep12: boolean;
    sep24: boolean;
    sep31: boolean;
    sep38: boolean;
  };
}

/**
 * Discover what the anchor configured for this agency supports.
 *
 * Runs the registry → client → SEP-1 path end-to-end against a real
 * anchor. No auth, no deposit — this proves the wiring works before the
 * signer + on-ramp slice lands. Output is the shape we'll surface in the
 * payment-method picker so the UI knows which currencies/SEPs to offer.
 *
 * Guards:
 *   - Throws if the anchor's NETWORK_PASSPHRASE doesn't match what the
 *     registry expects for this provider (e.g. testanchor must serve the
 *     testnet passphrase). Catches cross-network misconfig early.
 *   - Filters currencies by SEP-1 `status` — drops dead/private always,
 *     keeps test only for sandbox providers.
 */
export const discoverCapabilities = internalAction({
  args: { agencyId: v.id("agencies") },
  returns: v.object({
    provider: anchorProviderValidator,
    network: v.union(v.literal("testnet"), v.literal("pubnet")),
    networkPassphrase: v.string(),
    signingKey: v.union(v.string(), v.null()),
    currencies: v.array(
      v.object({
        code: v.string(),
        issuer: v.optional(v.string()),
        sep38Id: v.string(),
        status: v.union(
          v.literal("live"),
          v.literal("dead"),
          v.literal("test"),
          v.literal("private"),
        ),
      }),
    ),
    supports: v.object({
      sep6: v.boolean(),
      sep10: v.boolean(),
      sep12: v.boolean(),
      sep24: v.boolean(),
      sep31: v.boolean(),
      sep38: v.boolean(),
    }),
  }),
  handler: async (ctx, args): Promise<AnchorCapabilities> => {
    const providerName = await ctx.runQuery(internal.anchors.useCases.getProviderForAgency, {
      agencyId: args.agencyId,
    });
    const provider = getAnchorProvider(providerName);
    const expectedPassphrase = STELLAR_NETWORK_PASSPHRASES[provider.network];

    const client = createAnchorClient(providerName);
    const toml = await client.initialize();

    if (toml.NETWORK_PASSPHRASE !== expectedPassphrase) {
      throw new Error(
        `Anchor "${providerName}" returned NETWORK_PASSPHRASE "${toml.NETWORK_PASSPHRASE ?? "(none)"}", ` +
          `expected "${expectedPassphrase}" for ${provider.network}. Refusing to proceed — ` +
          `this would cause signed transactions to be rejected on submission.`,
      );
    }

    const [sep6, sep10, sep12, sep24, sep31, sep38] = await Promise.all([
      client.supportsSep(6),
      client.supportsSep(10),
      client.supportsSep(12),
      client.supportsSep(24),
      client.supportsSep(31),
      client.supportsSep(38),
    ]);

    const allowed = provider.sandbox ? ALLOWED_STATUSES_SANDBOX : ALLOWED_STATUSES_PROD;
    const currencies = (toml.CURRENCIES ?? [])
      .filter((c) => allowed.includes(c.status as CurrencyStatus | undefined))
      .map<AnchorCurrency>((c) => {
        const isNative = c.code === "native" || (c.code === "XLM" && !c.issuer);
        const code = isNative ? "XLM" : (c.code ?? "");
        const issuer = isNative ? undefined : c.issuer;
        return {
          code,
          issuer,
          sep38Id: isNative ? "stellar:native" : `stellar:${code}:${issuer}`,
          status: (c.status as CurrencyStatus | undefined) ?? "live",
        };
      });

    return {
      provider: providerName,
      network: provider.network,
      networkPassphrase: expectedPassphrase,
      signingKey: toml.SIGNING_KEY ?? null,
      currencies,
      supports: { sep6, sep10, sep12, sep24, sep31, sep38 },
    };
  },
});
