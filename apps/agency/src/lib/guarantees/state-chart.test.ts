import { describe, expect, it } from "vitest";

import { GUARANTEE_EVENTS, GUARANTEE_STATES } from "@convex/guarantees/domain";
import type { GuaranteeEvent, StateTimelineBucket } from "@convex/guarantees/domain";
import {
  CHART_FILL_OPACITY,
  GUARANTEE_EVENT_CHART_COLOR,
  GUARANTEE_SEVERITY_RAMP,
  GUARANTEE_STATE_CHART_COLOR,
} from "@/components/guarantees/state-chart-palette";
import {
  GUARANTEE_CONTEXT_STATES,
  GUARANTEE_STATE_STACK_ORDER,
  SHARED_X_AXIS_SCALE,
  axisUpperBound,
  bandScalePositions,
  buildContextFigures,
  buildStateLegend,
  hasAnyEvent,
  maxEventCount,
  maxStackedTotal,
  pointScalePositions,
  sliceRecentPeriods,
  toCompositionRows,
  toEventRows,
  type GuaranteeStateCounts,
} from "./state-chart";

// The card is two plots and a legend over the same buckets: a composition of
// the in-force book on top, the lifecycle moves that produced it underneath.
// Everything the card decides — which bands exist, in what order, which counts
// are context rather than composition, how much of the series the range toggle
// shows, which colour each series wears — lives in these pure modules so it
// can be asserted without a renderer.

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

function events(overrides: Partial<Record<GuaranteeEvent, number>> = {}) {
  return {
    created: 0,
    activated: 0,
    default_verified: 0,
    cover_paid: 0,
    closed: 0,
    ...overrides,
  };
}

function bucket(
  period: string,
  overrides: Partial<GuaranteeStateCounts>,
  eventOverrides: Partial<Record<GuaranteeEvent, number>> = {},
): StateTimelineBucket {
  return {
    period,
    countByState: counts(overrides),
    eventCount: events(eventOverrides),
  };
}

describe("GUARANTEE_STATE_STACK_ORDER", () => {
  it("stacks exactly the five in-force states, least severe at the base", () => {
    expect(GUARANTEE_STATE_STACK_ORDER).toEqual([
      "active",
      "in_arrears",
      "default_verified",
      "cover_committed",
      "in_eviction",
    ]);
  });

  // `closed` only ever accumulates, so stacking it pins the total flat and the
  // card stops describing the book under management; a draft carries no
  // coverage and consumes no capacity, so it is not under management either.
  it("keeps drafted and closed out of the stack and beside it as context", () => {
    expect(GUARANTEE_STATE_STACK_ORDER).not.toContain("drafted");
    expect(GUARANTEE_STATE_STACK_ORDER).not.toContain("closed");
    expect(GUARANTEE_CONTEXT_STATES).toEqual(["drafted", "closed"]);
  });

  it("accounts for every state exactly once across the stack and the context", () => {
    expect([...GUARANTEE_STATE_STACK_ORDER, ...GUARANTEE_CONTEXT_STATES].sort()).toEqual(
      [...GUARANTEE_STATES].sort(),
    );
  });
});

describe("state chart palette", () => {
  it("paints the stack with the ordered severity ramp, in ramp order", () => {
    expect(GUARANTEE_STATE_STACK_ORDER.map((state) => GUARANTEE_STATE_CHART_COLOR[state])).toEqual([
      ...GUARANTEE_SEVERITY_RAMP,
    ]);
  });

  // A repeated step would put two bands at the same lightness, which is what
  // made `drafted` and `closed` indistinguishable in the seven-band draft.
  it("gives every band its own ramp step", () => {
    const bandColors = GUARANTEE_STATE_STACK_ORDER.map(
      (state) => GUARANTEE_STATE_CHART_COLOR[state],
    );
    expect(new Set(bandColors).size).toBe(bandColors.length);
  });

  it("keeps the context states off the ramp entirely", () => {
    for (const state of GUARANTEE_CONTEXT_STATES) {
      expect(GUARANTEE_SEVERITY_RAMP).not.toContain(GUARANTEE_STATE_CHART_COLOR[state]);
    }
  });

  it("gives every event a colour and matches each one to the band it feeds", () => {
    for (const event of GUARANTEE_EVENTS) {
      expect(GUARANTEE_EVENT_CHART_COLOR[event]).toMatch(/^var\(--color-[a-z0-9-]+\)$/);
    }
    expect(GUARANTEE_EVENT_CHART_COLOR.activated).toBe(GUARANTEE_STATE_CHART_COLOR.active);
    expect(GUARANTEE_EVENT_CHART_COLOR.default_verified).toBe(
      GUARANTEE_STATE_CHART_COLOR.default_verified,
    );
    expect(GUARANTEE_EVENT_CHART_COLOR.cover_paid).toBe(
      GUARANTEE_STATE_CHART_COLOR.cover_committed,
    );
  });

  // Composited over the card, alpha compresses the ramp: at shadcn's 0.4 the
  // adjacent bands land ~0.032 L apart, half the 0.06 ordinal floor, and the
  // gradient that IS the encoding stops being visible. 0.85 is the lowest step
  // that keeps the drawn bands passing.
  it("keeps the fill alpha high enough for the ramp to survive compositing", () => {
    expect(CHART_FILL_OPACITY).toBeGreaterThanOrEqual(0.85);
    expect(CHART_FILL_OPACITY).toBeLessThanOrEqual(1);
  });
});

describe("buildStateLegend", () => {
  it("returns null while the counts are still loading", () => {
    expect(buildStateLegend(null)).toBeNull();
    expect(buildStateLegend(undefined)).toBeNull();
  });

  it("lists the five bands in stack order", () => {
    const legend = buildStateLegend(counts({ active: 4, closed: 2 }));
    expect(legend?.map((entry) => entry.state)).toEqual([
      "active",
      "in_arrears",
      "default_verified",
      "cover_committed",
      "in_eviction",
    ]);
  });

  it("keeps a band at zero rather than dropping it", () => {
    const legend = buildStateLegend(counts({ active: 6 }));
    expect(legend?.find((entry) => entry.state === "in_eviction")).toEqual({
      state: "in_eviction",
      count: 0,
    });
  });

  it("carries the count of each band", () => {
    const legend = buildStateLegend(counts({ active: 5, in_arrears: 2 }));
    expect(legend?.find((entry) => entry.state === "in_arrears")?.count).toBe(2);
    expect(legend?.find((entry) => entry.state === "active")?.count).toBe(5);
  });
});

describe("buildContextFigures", () => {
  it("returns null while the counts are still loading", () => {
    expect(buildContextFigures(null)).toBeNull();
    expect(buildContextFigures(undefined)).toBeNull();
  });

  it("carries drafted and closed, in lifecycle order", () => {
    expect(buildContextFigures(counts({ drafted: 3, closed: 9 }))).toEqual([
      { state: "drafted", count: 3 },
      { state: "closed", count: 9 },
    ]);
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

describe("toCompositionRows", () => {
  it("writes every stacked band as a top-level key, zeros included", () => {
    const [row] = toCompositionRows([bucket("2026-04", { active: 3, in_arrears: 1 })]);
    for (const state of GUARANTEE_STATE_STACK_ORDER) {
      expect(row?.[state]).toBeTypeOf("number");
    }
    expect(row?.active).toBe(3);
    expect(row?.in_arrears).toBe(1);
    expect(row?.in_eviction).toBe(0);
    expect(row?.period).toBe("2026-04");
  });

  // The whole point of dropping `closed`: the silhouette has to be able to
  // fall, which it cannot when a monotonically growing band is in the stack.
  it("lets the stacked total fall when guarantees leave the book", () => {
    const rows = toCompositionRows([
      bucket("2026-03", { active: 4, in_arrears: 1, closed: 1 }),
      bucket("2026-04", { active: 2, closed: 4 }),
    ]);
    const inForceTotal = (row: (typeof rows)[number]) =>
      GUARANTEE_STATE_STACK_ORDER.reduce((sum, state) => sum + row[state], 0);
    expect(rows.map(inForceTotal)).toEqual([5, 2]);
  });

  it("preserves period order", () => {
    const rows = toCompositionRows([
      bucket("2026-03", { active: 1 }),
      bucket("2026-04", { active: 2 }),
    ]);
    expect(rows.map((row) => row.period)).toEqual(["2026-03", "2026-04"]);
  });
});

describe("toEventRows", () => {
  it("writes every event as a top-level key, zeros included", () => {
    const [row] = toEventRows([bucket("2026-04", {}, { created: 2, cover_paid: 1 })]);
    expect(row).toEqual({
      period: "2026-04",
      created: 2,
      activated: 0,
      default_verified: 0,
      cover_paid: 1,
      closed: 0,
    });
  });

  // `default_verified` names both a band and an event. Two row shapes is what
  // keeps one from overwriting the other in a single flat record.
  it("keeps the event series separate from the composition series", () => {
    const source = [bucket("2026-04", { default_verified: 7 }, { default_verified: 1 })];
    expect(toCompositionRows(source)[0]?.default_verified).toBe(7);
    expect(toEventRows(source)[0]?.default_verified).toBe(1);
  });

  it("shares the period order with the composition rows", () => {
    const source = [bucket("2026-03", { active: 1 }), bucket("2026-04", { active: 2 })];
    expect(toEventRows(source).map((row) => row.period)).toEqual(
      toCompositionRows(source).map((row) => row.period),
    );
  });
});

describe("hasAnyEvent", () => {
  it("is false for a range in which nothing moved", () => {
    expect(hasAnyEvent(toEventRows([bucket("2026-03", { active: 2 })]))).toBe(false);
    expect(hasAnyEvent([])).toBe(false);
  });

  it("is true as soon as one event lands anywhere in the range", () => {
    const rows = toEventRows([
      bucket("2026-03", { active: 2 }),
      bucket("2026-04", { active: 2 }, { closed: 1 }),
    ]);
    expect(hasAnyEvent(rows)).toBe(true);
  });
});

describe("shared x scale", () => {
  // Recharts gives an area a POINT scale and bars a BAND scale unless told
  // otherwise, so the same month landed half a band apart in the two panels —
  // 44px on the frame this card renders at. Both panels now declare `band`.
  const frame = { plotLeft: 380, plotWidth: 1052, periods: 12 };

  it("is the band scale, so both panels place a period at the same x", () => {
    expect(SHARED_X_AXIS_SCALE).toBe("band");
    const area = bandScalePositions(frame);
    const bars = bandScalePositions(frame);
    expect(area[0]).toBe(bars[0]);
    expect(area[area.length - 1]).toBe(bars[bars.length - 1]);
    expect(area[0]).toBeCloseTo(423.83, 2);
    expect(area[area.length - 1]).toBeCloseTo(1388.17, 2);
  });

  it("measures the defect the band scale removes", () => {
    const band = bandScalePositions(frame);
    const point = pointScalePositions(frame);
    const halfBand = frame.plotWidth / (2 * frame.periods);
    expect(band[0] - point[0]).toBeCloseTo(halfBand, 5);
    expect(halfBand).toBeCloseTo(43.83, 2);
  });

  it("puts a single period in the middle of the frame", () => {
    expect(bandScalePositions({ plotLeft: 0, plotWidth: 100, periods: 1 })).toEqual([50]);
    expect(pointScalePositions({ plotLeft: 0, plotWidth: 100, periods: 1 })).toEqual([0]);
  });
});

describe("axis domains", () => {
  it("takes the peak of the stacked in-force total, ignoring context states", () => {
    const rows = toCompositionRows([
      bucket("2026-03", { active: 4, in_arrears: 1, closed: 40 }),
      bucket("2026-04", { active: 2, closed: 90 }),
    ]);
    expect(maxStackedTotal(rows)).toBe(5);
  });

  it("takes the peak of a single event series, not their sum", () => {
    const rows = toEventRows([
      bucket("2026-03", {}, { created: 2, closed: 3 }),
      bucket("2026-04", {}, { activated: 1 }),
    ]);
    expect(maxEventCount(rows)).toBe(3);
  });

  // The top of the data must never be the top of the panel: with no headroom
  // the stack fills its frame and reads as a solid block.
  it("always leaves headroom above the peak", () => {
    for (const peak of [1, 2, 5, 6, 9, 10, 12, 40, 99, 120, 617]) {
      expect(axisUpperBound(peak)).toBeGreaterThan(peak);
    }
  });

  it("rounds to a tick a reader recognises", () => {
    expect(axisUpperBound(0)).toBe(1);
    expect(axisUpperBound(1)).toBe(2);
    expect(axisUpperBound(6)).toBe(7);
    expect(axisUpperBound(10)).toBe(12);
    expect(axisUpperBound(120)).toBe(140);
  });
});
