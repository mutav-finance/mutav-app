/**
 * Shared types across @mutav/wallet/browser and @mutav/wallet/ledger.
 * Keep this file minimal — anything specific to one transport lives in
 * that subpath, not here. See spec § Section 7.
 */

export type Network = "PUBLIC" | "TESTNET";

export interface WalletConnection {
  readonly address: string;
  readonly network: Network;
  readonly transport: "browser-kit" | "ledger-hw";
}

export interface SigningResult {
  readonly signedXdr: string;
  readonly signerAddress: string;
}

export type WalletErrorCode =
  | "WALLET_NOT_INSTALLED"
  | "USER_REJECTED"
  | "NETWORK_MISMATCH"
  | "MALFORMED_XDR"
  | "CONNECTION_LOST"
  | "UNKNOWN";

export class WalletError extends Error {
  readonly code: WalletErrorCode;

  constructor(code: WalletErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = "WalletError";
  }
}
