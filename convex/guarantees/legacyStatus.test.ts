import { describe, expect, test } from "vitest";
import { CLOSE_REASONS, type CloseReason, type GuaranteeState } from "./machine";
import { LEGACY_CONTRACT_STATUS, toLegacyStatus, type LegacyContractStatus } from "./legacyStatus";

describe("LEGACY_CONTRACT_STATUS constants", () => {
  test("mirrors the four grandfathered contract statuses", () => {
    expect(LEGACY_CONTRACT_STATUS).toEqual({
      PENDENTE: "pendente",
      ATIVO: "ativo",
      ENCERRADO: "encerrado",
      CANCELADO: "cancelado",
    });
  });
});

describe("toLegacyStatus — every guarantee state maps to one legacy status", () => {
  const rows: Array<[GuaranteeState, CloseReason | undefined, LegacyContractStatus]> = [
    ["drafted", undefined, "pendente"],
    ["active", undefined, "ativo"],
    ["in_arrears", undefined, "ativo"],
    ["default_verified", undefined, "ativo"],
    ["cover_committed", undefined, "ativo"],
    ["in_eviction", undefined, "ativo"],
    ["closed", "canceled_pre_activation", "cancelado"],
    ["closed", "end_of_lease", "encerrado"],
    ["closed", "rescission", "encerrado"],
    ["closed", "abandonment", "encerrado"],
    ["closed", "eviction", "encerrado"],
    ["closed", "dispute_reversal", "encerrado"],
    ["closed", "death", "encerrado"],
    ["closed", undefined, "encerrado"],
  ];

  test.each(rows)("%s (reason %s) -> %s", (state, closeReason, expected) => {
    expect(toLegacyStatus(state, closeReason)).toBe(expected);
  });

  test("the close reason is ignored for non-closed states", () => {
    for (const reason of CLOSE_REASONS) {
      expect(toLegacyStatus("drafted", reason)).toBe("pendente");
      expect(toLegacyStatus("active", reason)).toBe("ativo");
      expect(toLegacyStatus("in_eviction", reason)).toBe("ativo");
    }
  });
});
