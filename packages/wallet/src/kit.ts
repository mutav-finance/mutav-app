/**
 * kit.ts — Stellar Wallets Kit v2 singleton (browser).
 *
 * EXPLICIT MODULES ONLY — never `allowAllModules()`. The CVE-laden Trezor / HOT /
 * NEAR adapters that got the kit removed (see CLAUDE.md) are simply never
 * imported: only the three modules below are pulled in by subpath. See
 * docs/architecture/decisions/0005-wallet-signing-architecture.md.
 *
 * `@mutav/wallet` is a shared package, so it never reads `process.env` — the
 * consuming app passes the network in (per CLAUDE.md § Environment variables).
 */
import { StellarWalletsKit, Networks } from "@creit.tech/stellar-wallets-kit";
import { FreighterModule } from "@creit.tech/stellar-wallets-kit/modules/freighter";
import { xBullModule } from "@creit.tech/stellar-wallets-kit/modules/xbull";
import { AlbedoModule } from "@creit.tech/stellar-wallets-kit/modules/albedo";

export type WalletNetwork = "testnet" | "public";

let initialized = false;

/**
 * Initialize the kit singleton once on the client. Idempotent — safe to call
 * from every entry point (`connect`, the provider's mount effect).
 */
export function initWalletKit(network: WalletNetwork): void {
  if (initialized) return;
  StellarWalletsKit.init({
    network: network === "public" ? Networks.PUBLIC : Networks.TESTNET,
    selectedWalletId: undefined,
    modules: [new FreighterModule(), new xBullModule(), new AlbedoModule()],
  });
  initialized = true;
}
