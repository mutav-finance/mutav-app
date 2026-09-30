import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { ReserveCoverage, ReserveSolvency } from "@convex/transparency/domain";

import {
  SNAPSHOT_STALE_AFTER_MS,
  SOLVENCY_STATUS,
  bookCapacity,
  isSnapshotStale,
  solvencyStatus,
} from "./view-model";

const REPO_ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..", "..");

function solvency(overrides: Partial<ReserveSolvency> = {}): ReserveSolvency {
  const reference = { id: "C", explorerUrl: "https://stellar.expert/explorer/testnet/contract/C" };
  return {
    network: "testnet",
    assetSymbol: "cUSD",
    totalAssets: 1_000,
    stableAssets: 1_000,
    coverageRequired: 400,
    rawCoverage: 400,
    coverageRatio: 2.5,
    requiredCoverageRatio: 1,
    remainingCapacity: 600,
    capacityCeiling: 1_000,
    capacityUtilization: 0.4,
    contracts: { vault: reference, policy: reference, registry: reference },
    positions: [],
    ...overrides,
  };
}

function coverage(solvencyRead: ReserveSolvency | null): ReserveCoverage {
  return {
    explorerUrl: "https://stellar.expert/explorer/testnet",
    available: true,
    storedValueCents: 540_000,
    fxUsdBrl: 5.4,
    fxSource: "bcb-ptax",
    fxQuotedAt: "2026-09-28 13:00",
    capturedAt: 0,
    assetCount: 1,
    solvency: solvencyRead,
  };
}

describe("solvencyStatus", () => {
  it("is null while the query is loading", () => {
    expect(solvencyStatus(undefined)).toBeNull();
    expect(solvencyStatus(null)).toBeNull();
  });

  it("is unavailable when there is no usable reserve read", () => {
    expect(solvencyStatus({ explorerUrl: "x", available: false })).toBe(
      SOLVENCY_STATUS.UNAVAILABLE,
    );
  });

  it("is unavailable when the snapshot predates the pulse solvency read", () => {
    expect(solvencyStatus(coverage(null))).toBe(SOLVENCY_STATUS.UNAVAILABLE);
  });

  it("is noBook when the contracts reserve no coverage", () => {
    expect(
      solvencyStatus(
        coverage(solvency({ coverageRequired: 0, rawCoverage: 0, coverageRatio: null })),
      ),
    ).toBe(SOLVENCY_STATUS.NO_BOOK);
  });

  it("is solvent when stable assets cover the requirement exactly", () => {
    expect(solvencyStatus(coverage(solvency({ coverageRatio: 1 })))).toBe(SOLVENCY_STATUS.SOLVENT);
  });

  it("is undercovered when stable assets fall below the requirement", () => {
    expect(solvencyStatus(coverage(solvency({ coverageRatio: 0.98 })))).toBe(
      SOLVENCY_STATUS.UNDERCOVERED,
    );
  });
});

describe("isSnapshotStale", () => {
  const capturedAt = 1_000_000;

  it("is fresh up to the threshold", () => {
    expect(isSnapshotStale(capturedAt, capturedAt + SNAPSHOT_STALE_AFTER_MS)).toBe(false);
  });

  it("is stale once the threshold passes", () => {
    expect(isSnapshotStale(capturedAt, capturedAt + SNAPSHOT_STALE_AFTER_MS + 1)).toBe(true);
  });

  it("tolerates three missed 15-minute cron ticks before flagging", () => {
    expect(SNAPSHOT_STALE_AFTER_MS).toBe(45 * 60 * 1000);
  });
});

describe("bookCapacity", () => {
  it("reports ceiling, used and remaining in the same raw-book units", () => {
    expect(bookCapacity(solvency({ capacityCeiling: 1_250, rawCoverage: 400 }))).toEqual({
      ceiling: 1_250,
      used: 400,
      remaining: 850,
    });
  });

  it("never reports negative headroom on an undercovered vault", () => {
    expect(bookCapacity(solvency({ capacityCeiling: 300, rawCoverage: 400 }))).toEqual({
      ceiling: 300,
      used: 400,
      remaining: 0,
    });
  });

  it("leaves ceiling and remaining unbounded when c = 0", () => {
    expect(bookCapacity(solvency({ capacityCeiling: null, rawCoverage: 400 }))).toEqual({
      ceiling: null,
      used: 400,
      remaining: null,
    });
  });
});

/**
 * The shared `@mutav/ui/transparency/*` panels read these namespaces from the
 * app's own catalog. Agency's copy is the reference; a key missing from admin
 * would render the raw key on /treasury.
 */
describe("shared transparency namespaces", () => {
  const SHARED = ["reserve", "capacity", "breakdown"] as const;

  function leafKeys(node: unknown, prefix = ""): string[] {
    if (typeof node !== "object" || node === null) return [prefix];
    return Object.entries(node).flatMap(([key, value]) =>
      leafKeys(value, prefix ? `${prefix}.${key}` : key),
    );
  }

  function transparency(app: string, locale: string): unknown {
    const parsed: unknown = JSON.parse(
      readFileSync(join(REPO_ROOT, "apps", app, "messages", `${locale}.json`), "utf8"),
    );
    if (typeof parsed !== "object" || parsed === null || !("transparency" in parsed)) {
      throw new Error(`apps/${app} ${locale}.json has no "transparency" namespace`);
    }
    return parsed.transparency;
  }

  it.each(["en", "pt-BR"])("admin %s carries every agency key", (locale) => {
    const agency = transparency("agency", locale);
    const admin = transparency("admin", locale);
    for (const namespace of SHARED) {
      expect(leafKeys(Reflect.get(Object(admin), namespace)).sort()).toEqual(
        leafKeys(Reflect.get(Object(agency), namespace)).sort(),
      );
    }
  });
});
