import { describe, expect, test } from "bun:test";
import { splitCommission } from "./commission";
import { priceContract, type PriceContractInput } from "./contract";

describe("priceContract", () => {
  const cases: Array<{ name: string; input: PriceContractInput }> = [
    {
      name: "high tier (score >= 800), 24x/3x base multipliers",
      input: {
        rentCents: 100_000,
        condoCents: 0,
        otherFeesCents: 0,
        score: 850,
        rentMultiplier: "24x",
        exitCostMultiplier: "3x",
      },
    },
    {
      name: "medium tier (600-799), 36x/5x mid multipliers, with condo",
      input: {
        rentCents: 200_000,
        condoCents: 10_000,
        otherFeesCents: 5_000,
        score: 650,
        rentMultiplier: "36x",
        exitCostMultiplier: "5x",
      },
    },
    {
      name: "low tier (< 600), 48x/7x max multipliers",
      input: {
        rentCents: 300_000,
        condoCents: 20_000,
        otherFeesCents: 10_000,
        score: 500,
        rentMultiplier: "48x",
        exitCostMultiplier: "7x",
      },
    },
    {
      name: "boundary at 800 picks high tier",
      input: {
        rentCents: 150_000,
        condoCents: 0,
        otherFeesCents: 0,
        score: 800,
        rentMultiplier: "24x",
        exitCostMultiplier: "3x",
      },
    },
    {
      name: "boundary at 600 picks medium tier",
      input: {
        rentCents: 150_000,
        condoCents: 0,
        otherFeesCents: 0,
        score: 600,
        rentMultiplier: "24x",
        exitCostMultiplier: "3x",
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
