import type { Result } from "../lib/result";

/**
 * The port between Convex and a future on-chain guarantee registry.
 *
 * Phase 1 (issue #427/#428) has no MUTAV program: the reserve is a Squads
 * multisig vault holding BRS, the registry stays off-chain, and a guarantee
 * goes active when compliance approves its signed contract and the capacity
 * check against the cached vault balance passes (`./balance.ts`). Nothing
 * calls this port today. It is kept, unimplemented and failing closed, for
 * phase 3, when ADR 0010's on-chain confirmation of `register_guarantee`
 * returns and the adapter — built on `@mutav-finance/mutav-protocol-solana` —
 * replaces `unavailableReserveReader` in this file.
 */

export type ExpectedRegistration = {
  /** 32-byte guarantee id as lowercase hex. */
  idHex: string;
  defaultCoverBaseUnits: bigint;
  exitCoverBaseUnits: bigint;
};

export type VerifiedRegistration = {
  slot: number;
  /** ISO timestamp of the block that confirmed the transaction. */
  registeredAt: string;
};

export const RESERVE_READER_ERROR_CODE = {
  UNAVAILABLE: "RESERVE_READER_UNAVAILABLE",
  TX_NOT_FOUND: "TX_NOT_FOUND",
  NOT_REGISTER_GUARANTEE: "NOT_REGISTER_GUARANTEE",
  ARGS_MISMATCH: "ARGS_MISMATCH",
  PROGRAM_ERROR: "PROGRAM_ERROR",
} as const satisfies Record<string, string>;

export type VerifyRegistrationError =
  | { code: typeof RESERVE_READER_ERROR_CODE.UNAVAILABLE }
  | { code: typeof RESERVE_READER_ERROR_CODE.TX_NOT_FOUND }
  | { code: typeof RESERVE_READER_ERROR_CODE.NOT_REGISTER_GUARANTEE }
  | { code: typeof RESERVE_READER_ERROR_CODE.ARGS_MISMATCH }
  | {
      code: typeof RESERVE_READER_ERROR_CODE.PROGRAM_ERROR;
      programErrorCode: number;
      programErrorName: string;
    };

export interface ReserveReader {
  /**
   * Phase 3: confirms `txSignature` is a finalized `register_guarantee` on the
   * reserve program with exactly the expected id and covers.
   */
  verifyRegistration(
    txSignature: string,
    expected: ExpectedRegistration,
  ): Promise<Result<VerifiedRegistration, VerifyRegistrationError>>;
}

export const unavailableReserveReader: ReserveReader = {
  async verifyRegistration() {
    return {
      success: false,
      error: { code: RESERVE_READER_ERROR_CODE.UNAVAILABLE },
      message: "There is no on-chain guarantee registry in phase 1",
    };
  },
};

/** The adapter a phase-3 caller would use. Swap this one binding for the real reader. */
export const reserveReader: ReserveReader = unavailableReserveReader;
