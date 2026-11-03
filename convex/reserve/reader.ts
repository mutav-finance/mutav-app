import type { Result } from "../lib/result";
import type { RESERVE_SOURCE_KIND } from "./health";
import { squadsReserveReader } from "./squadsReader";

/**
 * The port between Convex and the reserve on chain. Every chain read the
 * activation flow needs goes through `reserveReader`, so the adapter is the
 * only thing that changes as the reserve moves through its phases (ADR 0012):
 *
 *   1. Squads multisig holding BRS  → `squadsReserveReader` (today)
 *   2. simple vault                 → its own adapter
 *   3. MUTAV vault                  → the program client (`register_guarantee`, ADR 0010)
 *
 * Every adapter fails closed: an unconfigured or unreadable reserve is
 * `RESERVE_READER_UNAVAILABLE`, never a guessed number. Tests replace the
 * binding with `vi.mock("../reserve/reader")`.
 */

/** Where a capacity reading came from — named on the transparency page and in the audit trail. */
export type ReserveSource = {
  kind: typeof RESERVE_SOURCE_KIND.SQUADS_MULTISIG;
  vaultAddress: string;
  mint: string;
  /** The finalized slot the balance was read at. */
  slot: number;
};

export type ReserveCapacity = {
  /**
   * What the reserve holds, in BRS base units (6 decimals). Deliberately NOT
   * free capital: in phase 1 the chain keeps no registry of guarantees, so the
   * coverage the book already requires is subtracted in Convex — see
   * `phase1FreeCapitalBaseUnits` in `./health.ts`.
   */
  balanceBaseUnits: bigint;
  /** The coverage ratio `c`, in basis points. Phase 1: an off-chain constant. */
  coverageRatioBps: number;
  source: ReserveSource;
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
  /** The reserve's current balance and coverage ratio. */
  readCapacity(): Promise<Result<ReserveCapacity, ReadCapacityError>>;
  /**
   * Confirms `txSignature` is a finalized `register_guarantee` on the reserve
   * program with exactly the expected id and covers. Phase 3 only: the phase-1
   * and phase-2 adapters have no program to ask and return UNAVAILABLE.
   */
  verifyRegistration(
    txSignature: string,
    expected: ExpectedRegistration,
  ): Promise<Result<VerifiedRegistration, VerifyRegistrationError>>;
}

const UNAVAILABLE_MESSAGE = "The reserve reader is not wired to the chain";

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

/** The adapter every Convex function uses. Phase 1: the Squads multisig (ADR 0012). */
export const reserveReader: ReserveReader = squadsReserveReader;
