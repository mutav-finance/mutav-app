import type { Result } from "../lib/result";

/**
 * The port between Convex and the MUTAV reserve program on Solana. Every
 * chain read the registration flow needs goes through `reserveReader`, so the
 * adapter is the only thing that changes when the real client lands.
 *
 * Today the adapter is `unavailableReserveReader`: it fails closed, so
 * sending a contract for signature (the preflight needs free capital) and
 * recording a registration (the signature must be verified on chain) are both
 * refused until the real adapter — built on `@mutav-finance/mutav-protocol-solana`
 * once it is published — replaces it in this file. Tests replace it with
 * `vi.mock("../reserve/reader")`.
 */

export type ReserveCapacity = {
  /** The program's `free_capital` (spec §4), in BRS base units (6 decimals). */
  freeCapitalBaseUnits: bigint;
  /** The program's coverage ratio `c`, in basis points. */
  coverageRatioBps: number;
};

export type ReadCapacityError = { code: typeof RESERVE_READER_ERROR_CODE.UNAVAILABLE };

export type ExpectedRegistration = {
  /** 32-byte guarantee id as lowercase hex (`onchainGuaranteeIdHex`). */
  idHex: string;
  defaultCoverBaseUnits: bigint;
  exitCoverBaseUnits: bigint;
};

export type VerifiedRegistration = {
  slot: number;
  /** ISO timestamp of the block that confirmed the transaction. */
  registeredAt: string;
};

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

export const RESERVE_READER_ERROR_CODE = {
  UNAVAILABLE: "RESERVE_READER_UNAVAILABLE",
  TX_NOT_FOUND: "TX_NOT_FOUND",
  NOT_REGISTER_GUARANTEE: "NOT_REGISTER_GUARANTEE",
  ARGS_MISMATCH: "ARGS_MISMATCH",
  PROGRAM_ERROR: "PROGRAM_ERROR",
} as const satisfies Record<string, string>;

export interface ReserveReader {
  /** The reserve's current free capital and coverage ratio. */
  readCapacity(): Promise<Result<ReserveCapacity, ReadCapacityError>>;
  /**
   * Confirms `txSignature` is a finalized `register_guarantee` on the reserve
   * program with exactly the expected id and covers. A transaction the program
   * refused comes back as `PROGRAM_ERROR` with the custom error code and name.
   */
  verifyRegistration(
    txSignature: string,
    expected: ExpectedRegistration,
  ): Promise<Result<VerifiedRegistration, VerifyRegistrationError>>;
}

const UNAVAILABLE_MESSAGE = "The reserve reader is not wired to the chain yet";

export const unavailableReserveReader: ReserveReader = {
  async readCapacity() {
    return {
      success: false,
      error: { code: RESERVE_READER_ERROR_CODE.UNAVAILABLE },
      message: UNAVAILABLE_MESSAGE,
    };
  },
  async verifyRegistration() {
    return {
      success: false,
      error: { code: RESERVE_READER_ERROR_CODE.UNAVAILABLE },
      message: UNAVAILABLE_MESSAGE,
    };
  },
};

/** The adapter every Convex function uses. Swap this one binding for the real reader. */
export const reserveReader: ReserveReader = unavailableReserveReader;
