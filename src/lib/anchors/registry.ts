/**
 * Anchor provider registry.
 *
 * Single source of truth for which fiat ↔ token providers Mutav supports.
 * The Convex layer (and any other caller) goes through here rather than
 * importing a provider client directly, so adding a new provider is one
 * entry here + one provider client elsewhere.
 *
 * Today only the Stellar test anchor is wired. When real providers land
 * (Transfero, Etherfuse, a Brazilian Pix anchor, …) two patterns are
 * possible:
 *
 * 1. Provider exposes a SEP-compliant `stellar.toml` → compose the SEP
 *    modules into a stateful client following the `testanchor/` pattern
 *    and add a case below.
 * 2. Provider has a proprietary REST API → implement the `Anchor`
 *    interface from `./types` and add a case below.
 *
 * The discriminated union return type intentionally exposes the underlying
 * client shape rather than forcing every provider through a single
 * adapter interface. With one provider, an adapter is premature; with 2+
 * providers in distinct shapes we'll add the unification layer here.
 */

import type { TestAnchorClient, TestAnchorConfig } from "./testanchor/client";
import { createTestAnchorClient } from "./testanchor/client";

export const ANCHOR_PROVIDER_NAMES = ["testanchor"] as const;
export type AnchorProviderName = (typeof ANCHOR_PROVIDER_NAMES)[number];

export interface AnchorProviderEntry {
  readonly name: AnchorProviderName;
  readonly displayName: string;
  readonly description: string;
  readonly sandbox: boolean;
}

const REGISTRY: Record<AnchorProviderName, AnchorProviderEntry> = {
  testanchor: {
    name: "testanchor",
    displayName: "Stellar Test Anchor",
    description:
      "SDF-operated testnet anchor at testanchor.stellar.org. Use for development and smoke tests, never for real funds.",
    sandbox: true,
  },
};

export function listAnchorProviders(): readonly AnchorProviderEntry[] {
  return Object.values(REGISTRY);
}

export function getAnchorProvider(name: AnchorProviderName): AnchorProviderEntry {
  return REGISTRY[name];
}

export type AnchorClientFor<T extends AnchorProviderName> = T extends "testanchor"
  ? TestAnchorClient
  : never;

export interface CreateAnchorClientOptions {
  testanchor?: TestAnchorConfig;
  fetchFn?: typeof fetch;
}

/**
 * Instantiate a client for the given provider.
 *
 * The return type is discriminated on the provider name — callers that
 * pass a literal name get a precisely-typed client back. Callers that
 * pass a runtime value get a union and must narrow before use (or, more
 * usefully, branch their orchestration code per provider).
 */
export function createAnchorClient<T extends AnchorProviderName>(
  name: T,
  options?: CreateAnchorClientOptions,
): AnchorClientFor<T> {
  switch (name) {
    case "testanchor":
      return createTestAnchorClient(options?.testanchor, options?.fetchFn) as AnchorClientFor<T>;
  }
  throw new Error(`Unknown anchor provider: ${String(name)}`);
}
