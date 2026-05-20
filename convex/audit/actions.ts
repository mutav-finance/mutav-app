"use node";

import {
  Asset,
  Keypair,
  Memo,
  Networks,
  Operation,
  TransactionBuilder,
} from "@stellar/stellar-sdk";
import { internal } from "../_generated/api";
import { internalAction } from "../_generated/server";
import { getAuditAnchorSecret, getStellarHorizonUrl, getStellarNetwork } from "../lib/env";

type SubmitResult =
  | { status: "submitted"; anchorId: string; stellarTxHash: string; entryCount: number }
  | { status: "skipped_dev_mode"; anchorId: string; rootHash: string; entryCount: number }
  | { status: "failed"; anchorId: string; reason: string };

/**
 * Daily audit-log Merkle anchor. Triggered by the cron at 00:10 UTC.
 *
 * Flow:
 *   1. Compute the Merkle root over every audit entry since the last anchor.
 *      The mutation inserts a `pending` row regardless of whether we're
 *      going to submit to Stellar — local integrity check still runs.
 *   2. If `AUDIT_ANCHOR_SECRET` is set, build a 1-stroop self-payment from
 *      the dedicated audit account, with the Merkle root in MEMO_HASH and
 *      a `manageData` op carrying the period as a key. Submit to Horizon.
 *      MEMO_HASH is the cheapest 32-byte commitment Stellar supports;
 *      `manageData` adds a human-readable index (the period) so a forensic
 *      reader can browse account history by period at a glance.
 *   3. On success, mark anchor `submitted` with the txHash and network.
 *      On failure, mark `failed` with the reason. Either way, the cron
 *      tries again tomorrow with a fresh anchor covering `[failedPeriodEnd, now)`.
 *
 * Dev mode (no `AUDIT_ANCHOR_SECRET`): step 2 is skipped, anchor stays
 * `pending`. The local Merkle integrity check still works — `verifyLatestAnchor`
 * recomputes the root from current entries and compares to the stored row.
 * Without the Stellar tx, this only catches edits that happen *after* the
 * anchor; pre-anchor tampering by an attacker with full Convex access is
 * not detectable until prod sets the env var and real anchors start
 * landing on chain.
 */
export const submitDailyAnchor = internalAction({
  args: {},
  handler: async (ctx): Promise<SubmitResult> => {
    const { anchorId, rootHash, entryCount } = await ctx.runMutation(
      internal.audit.anchor.computeAuditAnchor,
      {},
    );

    const secret = getAuditAnchorSecret();
    if (!secret) {
      return { status: "skipped_dev_mode", anchorId, rootHash, entryCount };
    }

    const network = getStellarNetwork();
    const horizon = getStellarHorizonUrl();
    const networkPassphrase = network === "public" ? Networks.PUBLIC : Networks.TESTNET;

    try {
      const keypair = Keypair.fromSecret(secret);
      const publicKey = keypair.publicKey();

      // Fetch the source account's sequence number.
      const accountResponse = await fetch(`${horizon}/accounts/${publicKey}`);
      if (!accountResponse.ok) {
        const body = await accountResponse.text();
        throw new Error(
          `Horizon account fetch returned ${accountResponse.status}: ${body.slice(0, 200)}`,
        );
      }
      const accountData = (await accountResponse.json()) as { sequence: string };

      // SDK helper: TransactionBuilder needs an Account abstraction, not the
      // raw JSON. Constructing one manually keeps this action free of
      // direct Horizon-server dependencies (we only need /accounts and
      // /transactions, both vanilla REST).
      const { Account } = await import("@stellar/stellar-sdk");
      const source = new Account(publicKey, accountData.sequence);

      const periodKey = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
      const tx = new TransactionBuilder(source, {
        fee: "100",
        networkPassphrase,
      })
        .addMemo(Memo.hash(rootHash))
        .addOperation(
          Operation.manageData({
            name: `audit.${periodKey}`,
            value: rootHash,
          }),
        )
        // 1-stroop self-payment keeps the account state-changing without
        // affecting balance — required because manageData alone wouldn't
        // produce a balance-affecting op, and we want a clear "this account
        // is active" signal in account history.
        .addOperation(
          Operation.payment({
            destination: publicKey,
            asset: Asset.native(),
            amount: "0.0000001",
          }),
        )
        .setTimeout(180)
        .build();

      tx.sign(keypair);
      const xdr = tx.toEnvelope().toXDR("base64");

      const submitResponse = await fetch(`${horizon}/transactions`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ tx: xdr }).toString(),
      });

      if (!submitResponse.ok) {
        const body = await submitResponse.text();
        throw new Error(`Horizon submit returned ${submitResponse.status}: ${body.slice(0, 400)}`);
      }

      const submitData = (await submitResponse.json()) as { hash: string };
      const stellarTxHash = submitData.hash;

      await ctx.runMutation(internal.audit.anchor.markAnchorSubmitted, {
        anchorId,
        stellarTxHash,
        stellarNetwork: network,
      });

      return { status: "submitted", anchorId, stellarTxHash, entryCount };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      await ctx.runMutation(internal.audit.anchor.markAnchorFailed, {
        anchorId,
        stellarNetwork: network,
        failureReason: reason.slice(0, 1000),
      });
      return { status: "failed", anchorId, reason };
    }
  },
});
