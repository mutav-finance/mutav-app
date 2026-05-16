/**
 * Smoke test: exercise the anchor registry against the real Stellar test anchor.
 *
 * Run with: bun run scripts/anchor-registry-smoke.ts
 *
 * Validates the path: registry → testanchor client → SEP-1 fetch → toml parse.
 * No Convex, no signer — proves the library works in our environment before
 * the next slice wires it through Convex actions and onto a real auth flow.
 */

import { createAnchorClient, listAnchorProviders } from "../src/lib/anchors/registry";

async function main(): Promise<void> {
  console.log("Registered anchor providers:");
  for (const p of listAnchorProviders()) {
    console.log(`  • ${p.name} — ${p.displayName} (sandbox: ${p.sandbox})`);
    console.log(`    ${p.description}`);
  }

  console.log("\nInstantiating client for 'testanchor'…");
  const client = createAnchorClient("testanchor");

  console.log("Fetching stellar.toml from testanchor.stellar.org…");
  const toml = await client.initialize();

  console.log(`\nNETWORK_PASSPHRASE: ${toml.NETWORK_PASSPHRASE ?? "(none)"}`);
  console.log(`SIGNING_KEY:        ${toml.SIGNING_KEY ?? "(none)"}`);
  console.log(`WEB_AUTH_ENDPOINT:  ${toml.WEB_AUTH_ENDPOINT ?? "(none)"}`);
  console.log(`TRANSFER_SERVER_SEP0024: ${toml.TRANSFER_SERVER_SEP0024 ?? "(none)"}`);
  console.log(`TRANSFER_SERVER:    ${toml.TRANSFER_SERVER ?? "(none)"}`);
  console.log(`KYC_SERVER:         ${toml.KYC_SERVER ?? "(none)"}`);
  console.log(`ANCHOR_QUOTE_SERVER: ${toml.ANCHOR_QUOTE_SERVER ?? "(none)"}`);

  console.log("\nSEP support matrix:");
  const seps = [6, 10, 12, 24, 31, 38] as const;
  for (const sep of seps) {
    const supported = await client.supportsSep(sep);
    console.log(`  SEP-${sep.toString().padStart(2, "0")}: ${supported ? "✓" : "✗"}`);
  }

  console.log("\nCurrencies declared in stellar.toml:");
  for (const c of toml.CURRENCIES ?? []) {
    console.log(`  • ${c.code ?? "?"}${c.issuer ? ` issued by ${c.issuer}` : ""}`);
  }

  console.log("\n✓ Smoke test complete — registry + testanchor + SEP-1 all working.");
}

main().catch((err) => {
  console.error("\n✗ Smoke test failed:", err);
  process.exit(1);
});
