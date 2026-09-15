import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import type { StatusTagTone } from "@mutav/ui/status-tag";
import { GUARANTEE_STATE_NAMES, GUARANTEE_STATE_TONE, TONE } from "@mutav/ui/guarantee-state-tag";
import { GUARANTEE_STATES } from "@convex/guarantees/machine";
import {
  COLOR_SCHEMES,
  STATE_TONE_HEX,
  STATE_TONE_SEVERITY_ORDER,
  STATE_TONE_TOKEN,
  type ColorScheme,
} from "./state-tag";

/**
 * A guarantee state reaches an agency as a colored dot plus a label. The dot
 * only earns its place if two states that sit next to each other in the
 * severity ramp look different — including to the ~8% of men who cannot
 * separate red from green. Tailwind's amber-600 against orange-600, the pair
 * this file replaced, measured OKLab ΔE 1.6 under deuteranopia.
 *
 * The distance model is the one the palette was designed against: Euclidean
 * distance in OKLab ×100, with color-vision deficiency simulated by the
 * Machado, Oliveira & Fernandes (2009) transforms at severity 1.0. Swapping
 * the simulation model would move every borderline pair, so it is part of the
 * standard rather than an implementation detail.
 */

const NORMAL_VISION_FLOOR = 15;
const CVD_FLOOR = 6;
const CVD_TARGET = 8;

const MACHADO = {
  protan: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deutan: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
} as const satisfies Record<string, readonly (readonly number[])[]>;

type CvdKind = keyof typeof MACHADO;

type LinearRgb = readonly [number, number, number];
type Oklab = readonly [number, number, number];

function toLinearRgb(hex: string): LinearRgb {
  const digits = hex.replace(/^#/, "");
  const channels = [0, 2, 4].map((offset) => {
    const value = Number.parseInt(digits.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return [channels[0], channels[1], channels[2]];
}

function simulate([r, g, b]: LinearRgb, kind: CvdKind): LinearRgb {
  const matrix = MACHADO[kind];
  const clamp = (channel: number) => Math.max(0, Math.min(1, channel));
  return [
    clamp(matrix[0][0] * r + matrix[0][1] * g + matrix[0][2] * b),
    clamp(matrix[1][0] * r + matrix[1][1] * g + matrix[1][2] * b),
    clamp(matrix[2][0] * r + matrix[2][1] * g + matrix[2][2] * b),
  ];
}

function toOklab([r, g, b]: LinearRgb): Oklab {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function deltaE(first: string, second: string, kind?: CvdKind): number {
  const project = (hex: string) => {
    const linear = toLinearRgb(hex);
    return toOklab(kind ? simulate(linear, kind) : linear);
  };
  const [firstL, firstA, firstB] = project(first);
  const [secondL, secondA, secondB] = project(second);
  return 100 * Math.hypot(firstL - secondL, firstA - secondA, firstB - secondB);
}

/** Worst case across the two red-green deficiencies — the binding one. */
function cvdDeltaE(first: string, second: string): number {
  return Math.min(deltaE(first, second, "protan"), deltaE(first, second, "deutan"));
}

const GLOBALS_CSS = join(
  fileURLToPath(new URL(".", import.meta.url)),
  "..",
  "..",
  "app",
  "globals.css",
);

/**
 * `:root` carries the light theme and `.dark` the dark one, so the last
 * declaration of a token before the `.dark` block is the light value and the
 * last one overall is the dark value.
 */
function readTokens(scheme: ColorScheme): Record<string, string> {
  const css = readFileSync(GLOBALS_CSS, "utf8");
  const darkBlockStart = css.indexOf(".dark {");
  expect(darkBlockStart).toBeGreaterThan(-1);
  const region = scheme === "light" ? css.slice(0, darkBlockStart) : css.slice(darkBlockStart);
  const declarations = region.matchAll(/(--[a-z0-9-]+)\s*:\s*(#[0-9a-f]{6})\s*;/g);
  const tokens: Record<string, string> = {};
  for (const [, name, value] of declarations) tokens[name] = value;
  return tokens;
}

function adjacentTonePairs(): [StatusTagTone, StatusTagTone][] {
  return STATE_TONE_SEVERITY_ORDER.slice(1).map((tone, index) => [
    STATE_TONE_SEVERITY_ORDER[index],
    tone,
  ]);
}

describe("guarantee state tones", () => {
  it("resolves every state to a measured color in both schemes", () => {
    for (const state of GUARANTEE_STATES) {
      const tone = TONE[GUARANTEE_STATE_TONE[state]];
      expect(STATE_TONE_SEVERITY_ORDER, `state ${state}`).toContain(tone);
      for (const scheme of COLOR_SCHEMES) {
        expect(STATE_TONE_HEX[scheme][tone], `${scheme} ${state}`).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
  });

  it("keeps drafted and closed on one swatch, separated by their labels", () => {
    const drafted = TONE[GUARANTEE_STATE_TONE.drafted];
    const closed = TONE[GUARANTEE_STATE_TONE.closed];
    expect(drafted).toBe(closed);
    expect(drafted).toBe("neutral");
  });

  /**
   * `@mutav/ui` carries no Convex dependency, so its state list is a literal.
   * apps/admin paints its defaults queue from that literal — a state added to
   * the machine and not to the package would reach the staff console untoned,
   * and nothing else in either app can see the two lists disagree.
   */
  it("covers exactly the states the guarantee machine declares", () => {
    expect([...GUARANTEE_STATE_NAMES].sort()).toEqual([...GUARANTEE_STATES].sort());
  });
});

describe("state tone palette", () => {
  it.each([...COLOR_SCHEMES])("matches the %s tokens in globals.css", (scheme) => {
    const tokens = readTokens(scheme);
    for (const tone of STATE_TONE_SEVERITY_ORDER) {
      expect(tokens[STATE_TONE_TOKEN[tone]], `${scheme} ${tone}`).toBe(
        STATE_TONE_HEX[scheme][tone],
      );
    }
  });

  it.each([...COLOR_SCHEMES])(
    "separates every adjacent %s pair for a reader with normal color vision",
    (scheme) => {
      for (const [first, second] of adjacentTonePairs()) {
        const measured = deltaE(STATE_TONE_HEX[scheme][first], STATE_TONE_HEX[scheme][second]);
        expect(measured, `${scheme} ${first} vs ${second}`).toBeGreaterThanOrEqual(
          NORMAL_VISION_FLOOR,
        );
      }
    },
  );

  it.each([...COLOR_SCHEMES])(
    "separates every adjacent %s pair under protanopia and deuteranopia",
    (scheme) => {
      for (const [first, second] of adjacentTonePairs()) {
        const measured = cvdDeltaE(STATE_TONE_HEX[scheme][first], STATE_TONE_HEX[scheme][second]);
        expect(measured, `${scheme} ${first} vs ${second}`).toBeGreaterThanOrEqual(CVD_FLOOR);
      }
    },
  );

  it.each([...COLOR_SCHEMES])(
    "clears the %s CVD target on the warning pair the tag relies on most",
    (scheme) => {
      const measured = cvdDeltaE(
        STATE_TONE_HEX[scheme].warning,
        STATE_TONE_HEX[scheme]["warning-strong"],
      );
      expect(measured).toBeGreaterThanOrEqual(CVD_TARGET);
    },
  );

  it("reproduces the published distances for the pair this palette replaced", () => {
    expect(deltaE("#d97706", "#ea580c", "deutan")).toBeCloseTo(1.6, 1);
    expect(deltaE("#d97706", "#ea580c")).toBeCloseTo(6.7, 1);
  });
});
