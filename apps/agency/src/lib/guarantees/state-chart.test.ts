import { describe, expect, it } from "vitest";

import { GUARANTEE_STATES, type GuaranteeState } from "@convex/guarantees/machine";
import type { StateTimelineBucket } from "@convex/guarantees/domain";
import {
  GUARANTEE_STATE_CHART_COLOR,
  GUARANTEE_STATE_FILL_OPACITY,
} from "@/components/guarantees/state-chart-palette";
import {
  GUARANTEE_STATE_STACK_ORDER,
  buildStateLegend,
  sliceRecentPeriods,
  toChartRows,
  type GuaranteeStateCounts,
} from "./state-chart";

// The unified dashboard card is a chart plus a legend over the same seven
// states. Everything the card decides — which bands exist, in what order, how
// much of the series the range toggle shows, which states are told apart by
// something other than hue — lives in these pure functions so it can be
// asserted without a renderer.

function counts(overrides: Partial<GuaranteeStateCounts> = {}): GuaranteeStateCounts {
  return {
    drafted: 0,
    active: 0,
    in_arrears: 0,
    default_verified: 0,
    cover_committed: 0,
    in_eviction: 0,
    closed: 0,
    ...overrides,
  };
}

function bucket(period: string, overrides: Partial<GuaranteeStateCounts>): StateTimelineBucket {
  return { period, countByState: counts(overrides) };
}

describe("GUARANTEE_STATE_STACK_ORDER", () => {
  it("stacks every state exactly once", () => {
    expect([...GUARANTEE_STATE_STACK_ORDER].sort()).toEqual([...GUARANTEE_STATES].sort());
  });

  it("keeps the five in-force states as one contiguous block at the bottom", () => {
    expect(GUARANTEE_STATE_STACK_ORDER.slice(0, 5)).toEqual([
      "active",
      "in_arrears",
      "default_verified",
      "cover_committed",
      "in_eviction",
    ]);
    expect(GUARANTEE_STATE_STACK_ORDER.slice(5)).toEqual(["drafted", "closed"]);
  });
});

describe("state chart palette", () => {
  it("gives every state a band colour and a fill strength", () => {
    for (const state of GUARANTEE_STATES) {
      expect(GUARANTEE_STATE_CHART_COLOR[state]).toMatch(/^var\(--color-[a-z0-9-]+\)$/);
      expect(GUARANTEE_STATE_FILL_OPACITY[state]).toBeGreaterThan(0);
      expect(GUARANTEE_STATE_FILL_OPACITY[state]).toBeLessThanOrEqual(1);
    }
  });

  it("separates any two states that share a colour by fill strength", () => {
    const byColor = new Map<string, GuaranteeState[]>();
    for (const state of GUARANTEE_STATES) {
      const color = GUARANTEE_STATE_CHART_COLOR[state];
      byColor.set(color, [...(byColor.get(color) ?? []), state]);
    }

    const indistinguishable: string[] = [];
    for (const [color, states] of byColor) {
      const opacities = states.map((state) => GUARANTEE_STATE_FILL_OPACITY[state]);
      if (new Set(opacities).size !== states.length) {
        indistinguishable.push(`${color}: ${states.join(", ")}`);
      }
    }

    expect(indistinguishable).toEqual([]);
  });
});

describe("buildStateLegend", () => {
  it("returns null while the counts are still loading", () => {
    expect(buildStateLegend(null)).toBeNull();
    expect(buildStateLegend(undefined)).toBeNull();
  });

  it("lists all seven states in lifecycle order", () => {
    const legend = buildStateLegend(counts({ active: 4, closed: 2 }));
    expect(legend?.map((entry) => entry.state)).toEqual([
      "drafted",
      "active",
      "in_arrears",
      "default_verified",
      "cover_committed",
      "in_eviction",
      "closed",
    ]);
  });

  it("keeps a state at zero rather than dropping it", () => {
    const legend = buildStateLegend(counts({ active: 6 }));
    expect(legend?.find((entry) => entry.state === "in_eviction")).toEqual({
      state: "in_eviction",
      count: 0,
    });
  });

  it("carries the count of each state", () => {
    const legend = buildStateLegend(counts({ drafted: 1, active: 5, in_arrears: 2 }));
    expect(legend?.find((entry) => entry.state === "in_arrears")?.count).toBe(2);
    expect(legend?.find((entry) => entry.state === "active")?.count).toBe(5);
  });
});

describe("sliceRecentPeriods", () => {
  const series = [
    bucket("2026-01", { active: 1 }),
    bucket("2026-02", { active: 2 }),
    bucket("2026-03", { active: 3 }),
    bucket("2026-04", { active: 4 }),
  ];

  it("returns an empty series while the query is loading", () => {
    expect(sliceRecentPeriods(null, 6)).toEqual([]);
    expect(sliceRecentPeriods(undefined, 6)).toEqual([]);
  });

  it("keeps the most recent periods", () => {
    expect(sliceRecentPeriods(series, 2).map((b) => b.period)).toEqual(["2026-03", "2026-04"]);
  });

  it("returns everything when the range is wider than the series", () => {
    expect(sliceRecentPeriods(series, 12).map((b) => b.period)).toEqual([
      "2026-01",
      "2026-02",
      "2026-03",
      "2026-04",
    ]);
  });

  it("does not mutate the series it was given", () => {
    const sliced = sliceRecentPeriods(series, 12);
    expect(sliced).not.toBe(series);
    expect(series.map((b) => b.period)).toEqual(["2026-01", "2026-02", "2026-03", "2026-04"]);
  });
});

describe("toChartRows", () => {
  it("writes every state as a top-level key, zeros included", () => {
    const [row] = toChartRows([bucket("2026-04", { active: 3, in_arrears: 1 })]);
    expect(row).toEqual({
      period: "2026-04",
      drafted: 0,
      active: 3,
      in_arrears: 1,
      default_verified: 0,
      cover_committed: 0,
      in_eviction: 0,
      closed: 0,
    });
  });

  it("keeps each row summing to the size of the book in that period", () => {
    const rows = toChartRows([
      bucket("2026-03", { drafted: 1, active: 4, closed: 1 }),
      bucket("2026-04", { active: 3, in_arrears: 1, cover_committed: 1, closed: 1 }),
    ]);
    const total = (row: (typeof rows)[number]) =>
      GUARANTEE_STATES.reduce((sum, state) => sum + row[state], 0);
    expect(rows.map(total)).toEqual([6, 6]);
  });

  it("preserves period order", () => {
    const rows = toChartRows([bucket("2026-03", { active: 1 }), bucket("2026-04", { active: 2 })]);
    expect(rows.map((row) => row.period)).toEqual(["2026-03", "2026-04"]);
  });
});
