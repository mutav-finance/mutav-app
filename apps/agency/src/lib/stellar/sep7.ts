/**
 * SEP-7 "pay" URI builder. Universal across Stellar wallets that register
 * the `web+stellar:` protocol handler (Freighter, Lobstr, xBull, Albedo).
 *
 * Spec: https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0007.md
 */

type Sep7PayArgs = {
  /** Destination strkey — typically a muxed `M…` address. */
  destination: string;
  /** Amount in canonical units (e.g. "1234.7805" XLM). No grouping separators. */
  amount: string;
  /** Asset code. Defaults to native XLM. */
  assetCode?: string;
  /** Asset issuer `G…` strkey. Required for non-native assets. */
  assetIssuer?: string;
  /** Optional plain-text memo. */
  memo?: string;
};

export function buildSep7PayUri(args: Sep7PayArgs): string {
  const params = new URLSearchParams({
    destination: args.destination,
    amount: args.amount,
    asset_code: args.assetCode ?? "XLM",
  });
  if (args.assetIssuer) params.set("asset_issuer", args.assetIssuer);
  if (args.memo) {
    params.set("memo", args.memo);
    params.set("memo_type", "MEMO_TEXT");
  }
  return `web+stellar:pay?${params.toString()}`;
}
