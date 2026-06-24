/**
 * kit.ts — Stellar Wallets Kit v2 singleton (browser).
 *
 * EXPLICIT MODULES ONLY — never `allowAllModules()`. The CVE-laden Trezor / HOT /
 * NEAR adapters that got the kit removed (see CLAUDE.md) are simply never
 * imported: only the modules below are pulled in by subpath. See
 * docs/architecture/decisions/0005-wallet-signing-architecture.md.
 *
 * Extension-based wallets only (Freighter, xBull): no external web domain, so
 * the strict `apps/admin` CSP only needs the Stellar RPC in `connect-src`.
 * Freighter also backs a Ledger, covering the hardware case with zero extra
 * code. (A web-popup signer like Albedo would widen the admin CSP.)
 *
 * `@mutav/wallet` is a shared package, so it never reads `process.env` — the
 * consuming app passes the network in (per CLAUDE.md § Environment variables).
 */
import { StellarWalletsKit, Networks } from "@creit.tech/stellar-wallets-kit";
import { FreighterModule } from "@creit.tech/stellar-wallets-kit/modules/freighter";
import { xBullModule } from "@creit.tech/stellar-wallets-kit/modules/xbull";

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
    modules: [new FreighterModule(), new xBullModule()],
  });
  initialized = true;
}
