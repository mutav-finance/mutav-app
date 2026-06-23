/**
 * signer.ts — signing helpers.
 *
 * Two paths, mirroring mutav-pulse:
 *   - `makeSignTransaction(...)` returns a `signTransaction` function compatible
 *     with the stellar-sdk `ContractClient` / `AssembledTransaction.signAndSend()`
 *     option — the path for Soroban contract bindings (vault / policy clients).
 *   - `signAndSubmit(...)` signs a raw XDR via the kit and submits it through the
 *     RPC server, polling to confirmation — for XDRs built outside the bindings.
 *
 * NOTE on multisig (ADR 0005): a single `signAndSubmit` adds ONE signature. For
 * an M-of-N admin account the caller must instead collect M signatures on the
 * same envelope before submitting — that coordination lives in `apps/admin`.
 */
import { StellarWalletsKit } from "@creit.tech/stellar-wallets-kit";
import { rpc as StellarRpc, TransactionBuilder } from "@stellar/stellar-sdk";

export type SignTransaction = (
  xdr: string,
  opts?: { networkPassphrase?: string; address?: string },
) => Promise<{ signedTxXdr: string; signerAddress?: string }>;

/**
 * Pre-sign safety: parse the XDR under the expected network passphrase (rejects
 * malformed / mis-encoded envelopes early) and, when the signer is known, assert
 * the transaction's source account is that signer — so a tampered or
 * wrong-source XDR is not signed blind. The wallet's own review UI is the second
 * line; this is the programmatic first line. Fee-bump envelopes (no `source`
 * getter) are passed through — admin ops are plain transactions.
 */
function assertSignable(xdr: string, networkPassphrase: string, address?: string | null): void {
  let tx;
  try {
    tx = TransactionBuilder.fromXDR(xdr, networkPassphrase);
  } catch (err) {
    throw new Error(
      `refusing to sign: XDR did not parse under the expected network — ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  if (address && "source" in tx && tx.source !== address) {
    throw new Error(`refusing to sign: tx source ${tx.source} != connected signer ${address}`);
  }
}

/**
 * A `signTransaction` function for stellar-sdk contract bindings. Pass it as the
 * `signTransaction` option when constructing a generated `Client`.
 */
export function makeSignTransaction(
  networkPassphrase: string,
  address?: string | null,
): SignTransaction {
  return async (xdr, opts) => {
    const passphrase = opts?.networkPassphrase ?? networkPassphrase;
    const signer = opts?.address ?? address ?? undefined;
    assertSignable(xdr, passphrase, signer);
    return StellarWalletsKit.signTransaction(xdr, {
      networkPassphrase: passphrase,
      address: signer,
    });
  };
}

/**
 * Sign an arbitrary message (SEP-53) — no transaction, no fee, no submission.
 * Prompts the wallet to sign, proving control of the connected key. Useful for
 * ownership proofs / sign-in challenges and for verifying the signing path works
 * before any on-chain operation is wired.
 */
export async function signMessage(
  message: string,
  networkPassphrase: string,
  address?: string | null,
): Promise<{ signedMessage: string; signerAddress?: string }> {
  return StellarWalletsKit.signMessage(message, {
    networkPassphrase,
    address: address ?? undefined,
  });
}

export type SubmitConfig = {
  rpcUrl: string;
  networkPassphrase: string;
  address?: string | null;
  /** Max confirmation polls before timing out. */
  maxPolls?: number;
};

/**
 * Sign a raw XDR via the kit and submit it through the RPC server, returning the
 * confirmed transaction hash. Prefer the binding's `AssembledTransaction.signAndSend()`
 * (via `makeSignTransaction`) when working through generated contract clients.
 */
export async function signAndSubmit(xdr: string, config: SubmitConfig): Promise<string> {
  assertSignable(xdr, config.networkPassphrase, config.address);
  const { signedTxXdr, signerAddress } = await StellarWalletsKit.signTransaction(xdr, {
    networkPassphrase: config.networkPassphrase,
    address: config.address ?? undefined,
  });
  if (config.address && signerAddress && signerAddress !== config.address) {
    throw new Error(`signed by ${signerAddress}, expected ${config.address}`);
  }

  const server = new StellarRpc.Server(config.rpcUrl, { allowHttp: false });
  const tx = TransactionBuilder.fromXDR(signedTxXdr, config.networkPassphrase);

  const sent = await server.sendTransaction(tx);
  if (sent.status === "ERROR") {
    throw new Error(`sendTransaction failed: ${JSON.stringify(sent.errorResult)}`);
  }

  const maxPolls = config.maxPolls ?? 30;
  let got = await server.getTransaction(sent.hash);
  let attempts = 0;
  while (got.status === StellarRpc.Api.GetTransactionStatus.NOT_FOUND && attempts < maxPolls) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    got = await server.getTransaction(sent.hash);
    attempts += 1;
  }

  if (got.status !== StellarRpc.Api.GetTransactionStatus.SUCCESS) {
    throw new Error(`transaction ${sent.hash} did not confirm — last status: ${got.status}`);
  }
  return sent.hash;
}
