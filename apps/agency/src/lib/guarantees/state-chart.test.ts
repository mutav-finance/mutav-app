import { describe, expect, it } from "vitest";

import { GUARANTEE_EVENTS, GUARANTEE_STATES } from "@convex/guarantees/domain";
import type { GuaranteeEvent, StateTimelineBucket } from "@convex/guarantees/domain";
import {
  AREA_FILL_OPACITY,
  GUARANTEE_EVENT_CHART_COLOR,
  GUARANTEE_STATE_SWATCH_COLOR,
  IN_FORCE_AREA_COLOR,
} from "@/components/guarantees/state-chart-palette";
import { GUARANTEE_STATE_TONE } from "@mutav/ui/guarantee-state-tag";
import {
  GUARANTEE_CONTEXT_STATES,
  GUARANTEE_IN_FORCE_STATES,
  SHARED_X_AXIS_SCALE,
  axisUpperBound,
  bandScalePositions,
  buildContextFigures,
  buildStateLegend,
  maxInForce,
  pointScalePositions,
  sliceRecentPeriods,
  toChartRows,
  toInForceRows,
  type GuaranteeStateCounts,
} from "./state-chart";

// The card is one trend, one event panel and one count row over the same
// buckets. Everything it decides — which states count as in force, which
// counts are context, how much of the series the range toggle shows, which
// colour each series wears, where a period lands on the shared x axis — lives
// in these pure modules so it can be asserted without a renderer.

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

describe("GUARANTEE_IN_FORCE_STATES", () => {
  it("is exactly the five states Mutav is on risk for, in severity order", () => {
    expect(GUARANTEE_IN_FORCE_STATES).toEqual([
      "active",
      "in_arrears",
      "default_verified",
      "cover_committed",
      "in_eviction",
    ]);
  });

  // `closed` only ever accumulates, so counting it pins the total flat and the
  // card stops describing the book under management; a draft carries no
  // coverage and consumes no capacity, so it is not under management either.
  it("keeps drafted and closed out of the book and beside it as context", () => {
    expect(GUARANTEE_IN_FORCE_STATES).not.toContain("drafted");
    expect(GUARANTEE_IN_FORCE_STATES).not.toContain("closed");
    expect(GUARANTEE_CONTEXT_STATES).toEqual(["drafted", "closed"]);
  });

  it("accounts for every state exactly once across the book and the context", () => {
    expect([...GUARANTEE_IN_FORCE_STATES, ...GUARANTEE_CONTEXT_STATES].sort()).toEqual(
      [...GUARANTEE_STATES].sort(),
    );
  });
});

describe("state chart palette", () => {
  const TONE_DOT_COLOR: Record<string, string> = {
    accent: "var(--color-text-3)",
    success: "var(--color-success)",
    error: "var(--color-error)",
    neutral: "var(--color-text-3)",
    muted: "var(--color-text-3)",
    expiring: "var(--color-warning)",
    caution: "var(--color-warning-strong)",
  };

  // One state, one colour, everywhere on the page: the count row under the
  // chart and the status tags in the table below it read from the same tone
  // map, so a state cannot look like two different things on one screen.
  it("takes every state swatch from the status tag's tone", () => {
    for (const state of GUARANTEE_STATES) {
      expect(GUARANTEE_STATE_SWATCH_COLOR[state]).toBe(TONE_DOT_COLOR[GUARANTEE_STATE_TONE[state]]);
    }
  });

  // The trend is the headline number, not a severity reading, so it wears the
  // brand accent rather than anything from the status palette.
  it("plots the book in force in the brand accent, as a wash under a full stroke", () => {
    expect(IN_FORCE_AREA_COLOR).toBe("var(--color-chart-1)");
    expect(AREA_FILL_OPACITY).toBeGreaterThan(0);
    expect(AREA_FILL_OPACITY).toBeLessThanOrEqual(0.2);
  });

  // Green means the business worked, red means money left, grey means neither.
  it("colours events by valence, not by lifecycle position", () => {
    expect(GUARANTEE_EVENT_CHART_COLOR.activated).toBe("var(--color-success)");
    expect(GUARANTEE_EVENT_CHART_COLOR.default_verified).toBe("var(--color-warning)");
    expect(GUARANTEE_EVENT_CHART_COLOR.cover_paid).toBe("var(--color-error)");
  });

  it("gives the two valence-free events distinct neutrals", () => {
    expect(GUARANTEE_EVENT_CHART_COLOR.created).toBe("var(--color-text-3)");
    expect(GUARANTEE_EVENT_CHART_COLOR.closed).toBe("var(--color-text-2)");
    expect(GUARANTEE_EVENT_CHART_COLOR.created).not.toBe(GUARANTEE_EVENT_CHART_COLOR.closed);
  });

  it("gives every event a colour", () => {
    for (const event of GUARANTEE_EVENTS) {
      expect(GUARANTEE_EVENT_CHART_COLOR[event]).toMatch(/^var\(--color-[a-z0-9-]+\)$/);
    }
  });
});

describe("buildStateLegend", () => {
  it("returns null while the counts are still loading", () => {
    expect(buildStateLegend(null)).toBeNull();
    expect(buildStateLegend(undefined)).toBeNull();
  });

  it("lists the five in-force states in severity order", () => {
    const legend = buildStateLegend(counts({ active: 4, closed: 2 }));
    expect(legend?.map((entry) => entry.state)).toEqual([
      "active",
      "in_arrears",
      "default_verified",
      "cover_committed",
      "in_eviction",
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

describe("toInForceRows", () => {
  it("sums the five in-force states into one series per period", () => {
    const [row] = toInForceRows([
      bucket("2026-04", { active: 3, in_arrears: 1, in_eviction: 1, drafted: 9, closed: 40 }),
    ]);
    expect(row).toEqual({ period: "2026-04", inForce: 5 });
  });

  // The whole point of excluding `closed`: the line has to be able to fall,
  // which it cannot while a monotonically growing state is in the total.
  it("lets the total fall when guarantees leave the book", () => {
    const rows = toInForceRows([
      bucket("2026-03", { active: 4, in_arrears: 1, closed: 1 }),
      bucket("2026-04", { active: 2, closed: 4 }),
    ]);
    expect(rows.map((row) => row.inForce)).toEqual([5, 2]);
  });

  it("preserves period order", () => {
    const rows = toInForceRows([
      bucket("2026-03", { active: 1 }),
      bucket("2026-04", { active: 2 }),
    ]);
    expect(rows.map((row) => row.period)).toEqual(["2026-03", "2026-04"]);
  });
});

describe("shared x scale", () => {
  // Recharts gives an area a POINT scale (first sample flush left, spacing
  // width/(n-1)) and bars a BAND scale (centres, width/n). When the two lived
  // in separate panels that put the same month 44px apart on the frame this
  // card renders at. They share one plot now, and the axis declares `band`
  // explicitly so the area sits on the bar centres rather than the reverse.
  const frame = { plotLeft: 380, plotWidth: 1052, periods: 12 };

  it("declares the band scale, the one the bars force", () => {
    expect(SHARED_X_AXIS_SCALE).toBe("band");
    const positions = bandScalePositions(frame);
    expect(positions[0]).toBeCloseTo(423.83, 2);
    expect(positions[positions.length - 1]).toBeCloseTo(1388.17, 2);
  });

  it("measures the offset the band scale removes", () => {
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
  it("takes the peak of the in-force total, ignoring context states", () => {
    const rows = toInForceRows([
      bucket("2026-03", { active: 4, in_arrears: 1, closed: 40 }),
      bucket("2026-04", { active: 2, closed: 90 }),
    ]);
    expect(maxInForce(rows)).toBe(5);
  });

  // Both the area and the bars hang off one y axis, so the domain is set by
  // the book and never by an event count. A second, independently scaled bar
  // axis would paint two events as tall as a quarter of a two-hundred-
  // guarantee book, silently, as volume grew.
  it("is set by the book even when the events dwarf it", () => {
    const rows = toInForceRows([bucket("2026-03", { active: 2 }, { created: 40 })]);
    expect(axisUpperBound(maxInForce(rows))).toBe(3);
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

describe("toChartRows", () => {
  // One row, one plot, one y axis: the area and every bar read off the same
  // scale, which is only possible while they travel together.
  it("carries the book and that period's events in a single row", () => {
    const [row] = toChartRows([
      bucket("2026-04", { active: 3, in_arrears: 1, closed: 9 }, { created: 2, cover_paid: 1 }),
    ]);
    expect(row).toEqual({
      period: "2026-04",
      inForce: 4,
      created: 2,
      activated: 0,
      default_verified: 0,
      cover_paid: 1,
      closed: 0,
    });
  });

  // `closed` is a state AND an event. The row carries the event; the state's
  // count belongs to the count row, so nothing is silently overwritten.
  it("gives the shared name to the event, never to the state count", () => {
    const [row] = toChartRows([bucket("2026-04", { active: 1, closed: 30 }, { closed: 2 })]);
    expect(row?.closed).toBe(2);
    expect(row?.inForce).toBe(1);
  });
});
