import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  DEFAULTS_ERROR_CODES,
  DEFAULT_ACTION,
  FORBIDDEN_MESSAGE_KEY,
  UNEXPECTED_MESSAGE_KEY,
  coverPreview,
  daysOpen,
  errorMessageKey,
  outcomeForResult,
  outcomeForThrown,
} from "./view-model";

const MESSAGES_DIR = join(
  fileURLToPath(new URL(".", import.meta.url)),
  "..",
  "..",
  "..",
  "messages",
);

const LOCALES = ["en", "pt-BR"] as const;

function defaultsCatalog(locale: (typeof LOCALES)[number]): Record<string, unknown> {
  const parsed: unknown = JSON.parse(readFileSync(join(MESSAGES_DIR, `${locale}.json`), "utf8"));
  if (typeof parsed !== "object" || parsed === null || !("defaults" in parsed)) {
    throw new Error(`${locale}.json has no "defaults" namespace`);
  }
  const { defaults } = parsed;
  if (typeof defaults !== "object" || defaults === null) {
    throw new Error(`${locale}.json "defaults" is not an object`);
  }
  return { ...defaults };
}

/** Resolves a dotted key the way `useTranslations("defaults")` would. */
function lookup(catalog: Record<string, unknown>, dottedKey: string): unknown {
  let cursor: unknown = catalog;
  for (const segment of dottedKey.split(".")) {
    if (typeof cursor !== "object" || cursor === null || !(segment in cursor)) return undefined;
    cursor = Reflect.get(cursor, segment);
  }
  return cursor;
}

describe("outcomeForResult — happy paths", () => {
  it.each([
    [DEFAULT_ACTION.VERIFY, "toast.verified"],
    [DEFAULT_ACTION.COVER, "toast.covered"],
    [DEFAULT_ACTION.DISMISS, "toast.dismissed"],
  ])("%s success reports %s", (action, messageKey) => {
    expect(outcomeForResult({ action, result: { success: true } })).toEqual({
      kind: "success",
      messageKey,
    });
  });

  it("every success key exists in both catalogs", () => {
    for (const locale of LOCALES) {
      const catalog = defaultsCatalog(locale);
      for (const key of ["toast.verified", "toast.covered", "toast.dismissed"]) {
        expect(typeof lookup(catalog, key), `${locale} ${key}`).toBe("string");
      }
    }
  });
});

describe("outcomeForThrown — the role refusal", () => {
  /**
   * `mutationWithMutavRole` throws rather than returning a Result, so an
   * under-privileged staff member never reaches `outcomeForResult` at all.
   * The two sentences below are the wrapper's own, from convex/lib/auth.ts.
   */
  it.each([
    "Requires 'compliance' role or higher",
    "Requires 'admin' role or higher",
    "Not a Mutav staff member",
  ])("maps %s to the forbidden key", (message) => {
    expect(outcomeForThrown(new Error(message))).toEqual({
      kind: "error",
      messageKey: FORBIDDEN_MESSAGE_KEY,
    });
  });

  it("falls back to unexpected for an unrelated failure", () => {
    expect(outcomeForThrown(new Error("WebSocket closed"))).toEqual({
      kind: "error",
      messageKey: UNEXPECTED_MESSAGE_KEY,
    });
  });

  it("handles a non-Error rejection without throwing", () => {
    expect(outcomeForThrown("Requires 'compliance' role or higher").messageKey).toBe(
      FORBIDDEN_MESSAGE_KEY,
    );
    expect(outcomeForThrown(undefined).messageKey).toBe(UNEXPECTED_MESSAGE_KEY);
  });
});

describe("error code to message key", () => {
  it.each([...DEFAULTS_ERROR_CODES])("%s maps to its own key", (code) => {
    expect(errorMessageKey(code)).toBe(`errors.${code}`);
  });

  it("an unknown code never renders a raw server sentence", () => {
    expect(errorMessageKey("SOME_CODE_ADDED_LATER")).toBe(UNEXPECTED_MESSAGE_KEY);
  });

  it("routes a failed result through the same mapping", () => {
    expect(
      outcomeForResult({
        action: DEFAULT_ACTION.COVER,
        result: { success: false, error: { code: "NOTICE_NOT_VERIFIED" } },
      }),
    ).toEqual({ kind: "error", messageKey: "errors.NOTICE_NOT_VERIFIED" });
  });

  it("every mapped code has a string in both catalogs", () => {
    for (const locale of LOCALES) {
      const catalog = defaultsCatalog(locale);
      for (const code of [...DEFAULTS_ERROR_CODES, "FORBIDDEN", "unexpected"]) {
        expect(typeof lookup(catalog, `errors.${code}`), `${locale} ${code}`).toBe("string");
      }
    }
  });
});

describe("coverPreview — the clamp an operator must see before submitting", () => {
  it("draws the full claim when coverage covers it", () => {
    expect(
      coverPreview({
        requestedCents: 300_000,
        capacity: { ceilingCents: 1_200_000, availableCents: 900_000, reservedCents: 300_000 },
      }),
    ).toEqual({
      requestedCents: 300_000,
      availableCents: 900_000,
      appliedCents: 300_000,
      clamped: false,
      shortfallCents: 0,
    });
  });

  it("clamps to the remaining ceiling and names the shortfall", () => {
    expect(
      coverPreview({
        requestedCents: 500_000,
        capacity: { ceilingCents: 1_200_000, availableCents: 120_000, reservedCents: 1_080_000 },
      }),
    ).toEqual({
      requestedCents: 500_000,
      availableCents: 120_000,
      appliedCents: 120_000,
      clamped: true,
      shortfallCents: 380_000,
    });
  });

  it("draws nothing on an exhausted guarantee", () => {
    const preview = coverPreview({
      requestedCents: 250_000,
      capacity: { ceilingCents: 1_200_000, availableCents: 0, reservedCents: 1_200_000 },
    });
    expect(preview.appliedCents).toBe(0);
    expect(preview.clamped).toBe(true);
    expect(preview.shortfallCents).toBe(250_000);
  });
});

describe("daysOpen", () => {
  const NOW = Date.parse("2026-09-09T12:00:00.000Z");

  it("floors to whole days", () => {
    expect(daysOpen({ openedAt: "2026-09-06T00:00:00.000Z", now: NOW })).toBe(3);
  });

  it("reads an offset-form timestamp the seed writes", () => {
    expect(daysOpen({ openedAt: "2026-09-08T09:00:00-03:00", now: NOW })).toBe(1);
  });

  it("never goes negative for a future openedAt", () => {
    expect(daysOpen({ openedAt: "2026-10-01T00:00:00.000Z", now: NOW })).toBe(0);
  });

  it("returns zero rather than NaN on an unparsable timestamp", () => {
    expect(daysOpen({ openedAt: "not a date", now: NOW })).toBe(0);
  });
});
