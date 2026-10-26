import { describe, expect, test } from "vitest";
import {
  computeCovers,
  holdAmountBaseUnits,
  isOfferHoldActive,
  isOfferHoldLapsed,
  isTxSignatureShape,
  isValidOfferHoldDays,
  offerHoldExpiresAt,
  onchainGuaranteeIdHex,
  preflightOfferHold,
  REGISTER_GUARANTEE_ERRORS,
  RESERVE_PROGRAM_ERROR_NAMES,
  reserveProgramErrorName,
  resolveOfferHoldDays,
} from "./registration";

describe("computeCovers", () => {
  test("cents × 10_000 for both legs, read from the terms snapshot", () => {
    expect(computeCovers({ coverageCeilingCents: 3_000_000, exitCostCapCents: 600_000 })).toEqual({
      defaultCoverBaseUnits: BigInt(30_000_000_000),
      exitCoverBaseUnits: BigInt(6_000_000_000),
    });
  });

  test("stays exact past the float-safe integer range", () => {
    const covers = computeCovers({
      coverageCeilingCents: Number.MAX_SAFE_INTEGER,
      exitCostCapCents: 0,
    });
    expect(covers.defaultCoverBaseUnits).toBe(BigInt("90071992547409910000"));
  });
});

describe("onchainGuaranteeIdHex", () => {
  test("is sha256 of the namespaced publicId, as 64 hex chars", async () => {
    // sha256("mutav:guarantee:lease-001"), the pilot reserve app's REF.guaranteeId("lease-001").
    expect(await onchainGuaranteeIdHex("lease-001")).toBe(
      "95c6e86fc1a83ed5047e46806dbe8b98a3b4ed25d48946c4ac4b96967ac0c3be",
    );
  });

  test("two publicIds never share an id", async () => {
    const [a, b] = await Promise.all([onchainGuaranteeIdHex("A1"), onchainGuaranteeIdHex("A2")]);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(b);
  });
});

describe("holdAmountBaseUnits", () => {
  const covers = {
    defaultCoverBaseUnits: BigInt(30_000_000_000),
    exitCoverBaseUnits: BigInt(6_000_000_000),
  };

  test("c × (default + exit) / 10_000", () => {
    expect(holdAmountBaseUnits({ covers, coverageRatioBps: 2_500 })).toBe(BigInt(9_000_000_000));
  });

  test("rounds up so the hold never under-reserves", () => {
    expect(
      holdAmountBaseUnits({
        covers: { defaultCoverBaseUnits: BigInt(1), exitCoverBaseUnits: BigInt(0) },
        coverageRatioBps: 1,
      }),
    ).toBe(BigInt(1));
    expect(
      holdAmountBaseUnits({
        covers: { defaultCoverBaseUnits: BigInt(10_001), exitCoverBaseUnits: BigInt(0) },
        coverageRatioBps: 10_000,
      }),
    ).toBe(BigInt(10_001));
  });
});

describe("preflightOfferHold", () => {
  test("fits when free capital minus active holds covers the new hold exactly", () => {
    expect(
      preflightOfferHold({
        freeCapitalBaseUnits: BigInt(100),
        activeHoldsBaseUnits: BigInt(40),
        newHoldBaseUnits: BigInt(60),
      }),
    ).toMatchObject({ success: true, data: { remainingFreeCapitalBaseUnits: BigInt(0) } });
  });

  test("INSUFFICIENT_FREE_CAPITAL with the shortfall when it does not", () => {
    expect(
      preflightOfferHold({
        freeCapitalBaseUnits: BigInt(100),
        activeHoldsBaseUnits: BigInt(40),
        newHoldBaseUnits: BigInt(61),
      }),
    ).toMatchObject({
      success: false,
      error: { code: "INSUFFICIENT_FREE_CAPITAL", shortfallBaseUnits: BigInt(1) },
    });
  });

  test("holds already above free capital: the whole new hold is short", () => {
    expect(
      preflightOfferHold({
        freeCapitalBaseUnits: BigInt(100),
        activeHoldsBaseUnits: BigInt(150),
        newHoldBaseUnits: BigInt(10),
      }),
    ).toMatchObject({ success: false, error: { shortfallBaseUnits: BigInt(10) } });
  });
});

describe("resolveOfferHoldDays", () => {
  test.each([
    [
      { contract: 3, agency: 5, product: 10, platform: 14 },
      { days: 3, source: "contract" },
    ],
    [
      { agency: 5, product: 10, platform: 14 },
      { days: 5, source: "agency" },
    ],
    [
      { product: 10, platform: 14 },
      { days: 10, source: "product" },
    ],
    [{ platform: 14 }, { days: 14, source: "platform" }],
    [{}, { days: 7, source: "default" }],
  ])("%o → %o", (settings, expected) => {
    expect(resolveOfferHoldDays(settings)).toEqual(expected);
  });

  test.each([
    [1, true],
    [7, true],
    [90, true],
    [0, false],
    [91, false],
    [2.5, false],
    [Number.NaN, false],
  ])("%d days valid = %s", (days, valid) => {
    expect(isValidOfferHoldDays(days)).toBe(valid);
  });

  test("the expiry is the hold period after the send", () => {
    expect(offerHoldExpiresAt({ sentAt: 1_000, holdDays: 7 })).toBe(1_000 + 7 * 86_400_000);
  });
});

describe("offer hold activity", () => {
  const NOW = 10_000;

  test.each([
    ["inside its period", { expiresAt: NOW + 1 }, true, false],
    ["at its expiry", { expiresAt: NOW }, false, true],
    ["past its expiry", { expiresAt: NOW - 1 }, false, true],
    ["past its expiry but signed in time", { expiresAt: NOW - 1, signedAt: NOW - 2 }, true, false],
    ["released", { expiresAt: NOW + 1, releasedAt: NOW - 1 }, false, false],
  ])("%s: active=%s lapsed=%s", (_label, hold, active, lapsed) => {
    expect(isOfferHoldActive(hold, NOW)).toBe(active);
    expect(isOfferHoldLapsed(hold, NOW)).toBe(lapsed);
  });
});

describe("reserve program errors", () => {
  test("names follow the generated enum from 6000", () => {
    expect(RESERVE_PROGRAM_ERROR_NAMES).toHaveLength(47);
    expect(reserveProgramErrorName(6000)).toBe("Unauthorized");
    expect(reserveProgramErrorName(6002)).toBe("Paused");
    expect(reserveProgramErrorName(6007)).toBe("UnderCovered");
    expect(reserveProgramErrorName(6008)).toBe("InsufficientFreeCapital");
    expect(reserveProgramErrorName(6012)).toBe("GuaranteeCapExceeded");
    expect(reserveProgramErrorName(6046)).toBe("ClaimRevisionMismatch");
  });

  test("codes outside the enum are named as unknown", () => {
    expect(reserveProgramErrorName(5999)).toBe("UnknownProgramError");
    expect(reserveProgramErrorName(6047)).toBe("UnknownProgramError");
  });

  test("every register_guarantee error is a program error name", () => {
    for (const name of REGISTER_GUARANTEE_ERRORS) {
      expect(RESERVE_PROGRAM_ERROR_NAMES).toContain(name);
    }
  });
});

describe("isTxSignatureShape", () => {
  test("accepts an 88-char base58 signature", () => {
    expect(isTxSignatureShape("5".repeat(88))).toBe(true);
  });

  test.each(["", "abc", "0".repeat(88), "l".repeat(88), "5".repeat(89)])("refuses %j", (value) => {
    expect(isTxSignatureShape(value)).toBe(false);
  });
});
