/**
 * Internal helpers for parsing anchor responses.
 *
 * Anchors are external systems — every JSON body crosses a trust boundary.
 * These helpers assert the minimum shape the SEP spec promises so a
 * malformed response throws `SepApiError` instead of returning undefined
 * typed as the response shape (which causes silent failures downstream).
 *
 * Not exported from `./index.ts` — internal to the SEP layer.
 */

import { SepApiError } from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}

export function unwrapTransaction<T>(data: unknown, action: string): T {
  if (!isRecord(data) || !data.transaction) {
    throw new SepApiError(`Anchor response missing transaction (${action})`, 0);
  }
  return data.transaction as T;
}

export function unwrapTransactions<T>(data: unknown, action: string): T[] {
  if (!isRecord(data) || !Array.isArray(data.transactions)) {
    throw new SepApiError(`Anchor response missing transactions array (${action})`, 0);
  }
  return data.transactions as T[];
}

/**
 * Assert that an anchor response is an object and contains every required
 * field. Returns the typed response on success; throws `SepApiError` on
 * shape violations.
 */
export function assertShape<T extends object>(
  data: unknown,
  required: ReadonlyArray<keyof T>,
  action: string,
): T {
  if (!isRecord(data)) {
    throw new SepApiError(`Anchor response is not an object (${action})`, 0);
  }
  for (const field of required) {
    if (!(field in data) || data[field as string] === undefined || data[field as string] === null) {
      throw new SepApiError(
        `Anchor response missing required field "${String(field)}" (${action})`,
        0,
      );
    }
  }
  return data as T;
}
