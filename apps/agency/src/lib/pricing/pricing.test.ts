import { describe, expect, test } from "bun:test";
import { splitCommission } from "./commission";
import { priceContract, type PriceContractInput } from "./contract";

describe("priceContract", () => {
  const cases: Array<{ name: string; input: PriceContractInput }> = [
    {
      name: "high tier (score >= 800) — 9% fee",
      input: {
        rentCents: 100_000,
        condoCents: 0,
        otherFeesCents: 0,
        score: 850,
      },
    },
    {
      name: "medium tier (600-799) — 12% fee, with condo",
      input: {
        rentCents: 200_000,
        condoCents: 10_000,
        otherFeesCents: 5_000,
        score: 650,
      },
    },
    {
      name: "low tier (400-599) — 15% fee",
      input: {
        rentCents: 300_000,
        condoCents: 20_000,
        otherFeesCents: 10_000,
        score: 500,
      },
    },
    {
      name: "boundary at 800 picks high tier",
      input: {
        rentCents: 150_000,
        condoCents: 0,
        otherFeesCents: 0,
        score: 800,
      },
    },
    {
      name: "boundary at 600 picks medium tier",
      input: {
        rentCents: 150_000,
        condoCents: 0,
        otherFeesCents: 0,
        score: 600,
      },
    },
  ];

  for (const c of cases) {
    test(c.name, () => {
      expect(priceContract(c.input)).toMatchSnapshot();
    });
  }
});

describe("splitCommission", () => {
  test("commission is 1.5% of fee, rounded", () => {
    expect(splitCommission(10_000)).toEqual({ commissionCents: 150, totalCents: 10_150 });
  });

  test("total = fee + commission for every input", () => {
    for (const fee of [0, 1, 33, 67, 167, 1_000, 9_999, 10_000, 999_999, 1_234_567]) {
      const { commissionCents, totalCents } = splitCommission(fee);
      expect(totalCents).toBe(fee + commissionCents);
    }
  });
});
